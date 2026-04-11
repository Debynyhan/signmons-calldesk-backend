import { ConversationLifecycleService } from "../conversation-lifecycle.service";
import type { ConversationCustomerResolver } from "../conversation-customer-resolver";
import type { ConversationsRepository } from "../conversations.repository";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { LoggingService } from "../../logging/logging.service";

describe("ConversationLifecycleService", () => {
  let repository: {
    findConversationFirst: jest.Mock;
    createConversation: jest.Mock;
    updateConversation: jest.Mock;
    createCustomer: jest.Mock;
    createConversationJobLinkOrNullOnConflict: jest.Mock;
  };
  let customerResolver: {
    resolveVoiceCustomer: jest.Mock;
    resolveSmsCustomer: jest.Mock;
  };
  let loggingService: {
    warn: jest.Mock;
  };
  let service: ConversationLifecycleService;

  beforeEach(() => {
    repository = {
      findConversationFirst: jest.fn(),
      createConversation: jest.fn(),
      updateConversation: jest.fn(),
      createCustomer: jest.fn(),
      createConversationJobLinkOrNullOnConflict: jest.fn(),
    };
    customerResolver = {
      resolveVoiceCustomer: jest.fn(),
      resolveSmsCustomer: jest.fn(),
    };
    loggingService = {
      warn: jest.fn(),
    };

    service = new ConversationLifecycleService(
      repository as unknown as ConversationsRepository,
      customerResolver as unknown as ConversationCustomerResolver,
      new SanitizationService(),
      loggingService as unknown as LoggingService,
    );
  });

  it("creates a webchat conversation when none exists", async () => {
    repository.findConversationFirst.mockResolvedValue(null);
    repository.createCustomer.mockResolvedValue({ id: "customer-1" });
    repository.createConversation.mockResolvedValue({ id: "conversation-1" });

    await service.ensureConversation("tenant-1", "session-1");

    expect(repository.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          fullName: "Unknown Caller",
        }),
      }),
    );
    expect(repository.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          channel: "WEBCHAT",
          status: "ONGOING",
          currentFSMState: "TRIAGE",
          collectedData: expect.objectContaining({
            sessionId: "session-1",
            source: "WEBCHAT",
          }),
        }),
      }),
    );
  });

  it("returns existing sms conversation and backfills sms metadata", async () => {
    customerResolver.resolveSmsCustomer.mockResolvedValue({ id: "customer-1" });
    repository.findConversationFirst.mockResolvedValue({
      id: "conversation-1",
      twilioSmsSid: null,
      collectedData: { source: "SMS" },
    });
    repository.updateConversation.mockResolvedValue({
      id: "conversation-1",
      collectedData: { source: "SMS", sessionId: "conversation-1" },
    });

    const result = await service.ensureSmsConversation({
      tenantId: "tenant-1",
      fromNumber: "2167448929",
      smsSid: "SM123",
    });

    expect(customerResolver.resolveSmsCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        normalizedPhone: "+12167448929",
        smsSid: "SM123",
      }),
    );
    expect(repository.updateConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conversation-1" },
        data: expect.objectContaining({
          twilioSmsSid: "SM123",
          collectedData: expect.objectContaining({
            sessionId: "conversation-1",
            smsFrom: "+12167448929",
          }),
        }),
      }),
    );
    expect(result.sessionId).toBe("conversation-1");
  });

  it("creates voice consent conversation with seeded caller metadata", async () => {
    repository.findConversationFirst.mockResolvedValue(null);
    customerResolver.resolveVoiceCustomer.mockResolvedValue({ id: "customer-1" });
    repository.createConversation.mockResolvedValue({
      id: "conversation-1",
      collectedData: {},
    });

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      requestId: "req-1",
      callerPhone: "2167448929",
    });

    expect(customerResolver.resolveVoiceCustomer).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      callSid: "CA123",
      normalizedPhone: "+12167448929",
    });
    expect(repository.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          twilioCallSid: "CA123",
          collectedData: expect.objectContaining({
            requestId: "req-1",
            callerPhone: "+12167448929",
            source: "VOICE",
            voiceConsent: expect.objectContaining({
              granted: true,
              callSid: "CA123",
            }),
          }),
        }),
      }),
    );
  });

  it("marks disconnected ongoing calls as abandoned", async () => {
    repository.findConversationFirst.mockResolvedValue({
      id: "conversation-1",
      status: "ONGOING",
      endedAt: null,
      collectedData: {},
    });
    repository.updateConversation.mockResolvedValue({
      id: "conversation-1",
      status: "ABANDONED",
    });

    await service.completeVoiceConversationByCallSid({
      tenantId: "tenant-1",
      callSid: "CA123",
      source: "disconnect",
    });

    expect(repository.updateConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conversation-1" },
        data: expect.objectContaining({
          status: "ABANDONED",
          collectedData: expect.objectContaining({
            voiceLifecycle: expect.objectContaining({
              endSource: "disconnect",
              endedAt: expect.any(String),
            }),
          }),
        }),
      }),
    );
  });

  it("creates job link with default relation type", async () => {
    repository.createConversationJobLinkOrNullOnConflict.mockResolvedValue({
      id: "link-1",
    });

    await service.linkJobToConversation({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      jobId: "job-1",
    });

    expect(
      repository.createConversationJobLinkOrNullOnConflict,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          conversationId: "conversation-1",
          jobId: "job-1",
          relationType: "CREATED_FROM",
        }),
      }),
    );
  });
});
