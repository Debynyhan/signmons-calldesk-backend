import { ConversationsService } from "../conversations.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";
import { LoggingService } from "../../logging/logging.service";

describe("ConversationsService", () => {
  let prisma: {
    conversation: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    customer: { create: jest.Mock; findFirst: jest.Mock };
  };
  let service: ConversationsService;
  let loggingService: { warn: jest.Mock };

  beforeEach(() => {
    prisma = {
      conversation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    loggingService = {
      warn: jest.fn(),
    };

    service = new ConversationsService(
      prisma as unknown as PrismaService,
      new SanitizationService(),
      loggingService as unknown as LoggingService,
    );
  });

  it("persists CallSid on voice consent conversation creation", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null as never);
    prisma.customer.findFirst.mockResolvedValue(null as never);
    prisma.customer.create.mockResolvedValue({ id: "cust-1" } as never);
    prisma.conversation.create.mockResolvedValue({ id: "conv-1" } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      requestId: "req-1",
      callerPhone: "2167448929",
    });

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          twilioCallSid: "CA123",
          collectedData: expect.objectContaining({
            requestId: "req-1",
            callerPhone: "+12167448929",
            address: expect.objectContaining({
              status: "MISSING",
              locked: false,
            }),
            voiceConsent: expect.objectContaining({
              granted: true,
              method: "implied",
              callSid: "CA123",
            }),
          }),
        }),
      }),
    );
  });

  it("reuses an existing customer by normalized phone", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null as never);
    prisma.customer.findFirst.mockResolvedValue({ id: "cust-1" } as never);
    prisma.conversation.create.mockResolvedValue({ id: "conv-1" } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      callerPhone: "(216) 744-8929",
    });

    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("creates a customer when none exists for caller phone", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null as never);
    prisma.customer.findFirst.mockResolvedValue(null as never);
    prisma.customer.create.mockResolvedValue({ id: "cust-1" } as never);
    prisma.conversation.create.mockResolvedValue({ id: "conv-1" } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      callerPhone: "2167448929",
    });

    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: "+12167448929",
        }),
      }),
    );
  });

  it("creates a placeholder customer if customer creation fails", async () => {
    prisma.conversation.findFirst.mockResolvedValue(null as never);
    prisma.customer.findFirst.mockResolvedValue(null as never);
    prisma.customer.create
      .mockRejectedValueOnce(new Error("insert failed"))
      .mockResolvedValueOnce({ id: "cust-2" } as never);
    prisma.conversation.create.mockResolvedValue({ id: "conv-1" } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      callerPhone: "2167448929",
    });

    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice_customer_create_failed",
        tenantId: "tenant-1",
      }),
      ConversationsService.name,
    );
    expect(prisma.customer.create).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite callerPhone once set", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: { callerPhone: "+12167448929", voiceConsent: { granted: true } },
    } as never);

    await service.ensureVoiceConsentConversation({
      tenantId: "tenant-1",
      callSid: "CA123",
      callerPhone: "2165550000",
    });

    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("stores normalized transcript on voice turn", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: { voiceConsent: { granted: true } },
    } as never);
    prisma.conversation.update.mockResolvedValue({ id: "conv-1" } as never);

    await service.updateVoiceTranscript({
      tenantId: "tenant-1",
      callSid: "CA123",
      transcript: "  no   heat  ",
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collectedData: expect.objectContaining({
            lastTranscript: "no heat",
          }),
        }),
      }),
    );
  });

  it("appends an address confirmation entry", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    } as never);
    prisma.conversation.update.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    } as never);

    await service.updateVoiceAddressState({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      addressState: {
        candidate: null,
        confirmed: "123 Main St",
        status: "CONFIRMED",
        locked: true,
        attemptCount: 1,
        sourceEventId: "evt-1",
      },
      confirmation: {
        field: "address",
        value: "123 Main St",
        confirmedAt: "2026-01-01T00:00:00.000Z",
        sourceEventId: "evt-1",
        channel: "VOICE",
      },
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collectedData: expect.objectContaining({
            address: expect.objectContaining({
              status: "CONFIRMED",
            }),
            fieldConfirmations: expect.arrayContaining([
              expect.objectContaining({
                field: "address",
                value: "123 Main St",
                sourceEventId: "evt-1",
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("does not overwrite a locked confirmed address", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: {
        address: {
          candidate: null,
          confirmed: "123 Main St",
          status: "CONFIRMED",
          locked: true,
          attemptCount: 1,
          sourceEventId: "evt-1",
        },
      },
    } as never);
    prisma.conversation.update.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    } as never);

    await service.updateVoiceAddressState({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      addressState: {
        candidate: "456 Elm St",
        confirmed: "456 Elm St",
        status: "CONFIRMED",
        locked: true,
        attemptCount: 2,
        sourceEventId: "evt-2",
      },
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collectedData: expect.objectContaining({
            address: expect.objectContaining({
              confirmed: "123 Main St",
              status: "CONFIRMED",
              locked: true,
            }),
          }),
        }),
      }),
    );
  });

  it("promotes a name from SMS confirmation", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: {
        name: {
          candidate: { value: "Dean Banks", sourceEventId: "evt-1", createdAt: "2026-01-01T00:00:00.000Z" },
          confirmed: { value: null, sourceEventId: null, confirmedAt: null },
          status: "CANDIDATE",
          locked: true,
          attemptCount: 1,
        },
      },
    } as never);
    prisma.conversation.update.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    } as never);

    await service.promoteNameFromSms({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      value: "Dean Banks",
      sourceEventId: "sms-1",
      confirmedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collectedData: expect.objectContaining({
            name: expect.objectContaining({
              confirmed: expect.objectContaining({
                value: "Dean Banks",
                sourceEventId: "sms-1",
              }),
              status: "CONFIRMED",
              locked: true,
            }),
            fieldConfirmations: expect.arrayContaining([
              expect.objectContaining({
                field: "name",
                value: "Dean Banks",
                sourceEventId: "sms-1",
                channel: "SMS",
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("promotes an address from SMS confirmation", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: {
        address: {
          candidate: "123 Main St",
          confirmed: null,
          status: "CANDIDATE",
          locked: true,
          attemptCount: 1,
          sourceEventId: "evt-addr-1",
        },
      },
    } as never);
    prisma.conversation.update.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    } as never);

    await service.promoteAddressFromSms({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      value: "123 Main St",
      sourceEventId: "sms-addr-1",
      confirmedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collectedData: expect.objectContaining({
            address: expect.objectContaining({
              confirmed: "123 Main St",
              status: "CONFIRMED",
              locked: true,
            }),
            fieldConfirmations: expect.arrayContaining([
              expect.objectContaining({
                field: "address",
                value: "123 Main St",
                sourceEventId: "sms-addr-1",
                channel: "SMS",
              }),
            ]),
          }),
        }),
      }),
    );
  });
});
