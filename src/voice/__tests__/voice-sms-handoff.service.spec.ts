import type { ConversationsService } from "../../conversations/conversations.service";
import type { LoggingService } from "../../logging/logging.service";
import { VoiceSmsHandoffService } from "../voice-sms-handoff.service";

const buildConversationsService = (
  overrides: Record<string, unknown> = {},
): ConversationsService =>
  ({
    getConversationById: jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: {},
    }),
    getVoiceSmsPhoneState: jest.fn().mockReturnValue({
      value: null,
      source: null,
      confirmed: false,
      confirmedAt: null,
      attemptCount: 0,
      lastPromptedAt: null,
    }),
    updateVoiceSmsPhoneState: jest.fn().mockResolvedValue(null),
    updateVoiceSmsHandoff: jest.fn().mockResolvedValue(null),
    clearVoiceSmsHandoff: jest.fn().mockResolvedValue(null),
    ...overrides,
  }) as unknown as ConversationsService;

const buildLoggingService = (
  overrides: Record<string, unknown> = {},
): LoggingService =>
  ({
    log: jest.fn(),
    ...overrides,
  }) as unknown as LoggingService;

describe("VoiceSmsHandoffService", () => {
  it("prompts ANI confirmation when fallback phone is available", async () => {
    const conversationsService = buildConversationsService({
      getConversationById: jest.fn().mockResolvedValue({
        id: "conversation-1",
        collectedData: { callerPhone: "+12167448929" },
      }),
      getVoiceSmsPhoneState: jest.fn().mockReturnValue({
        value: null,
        source: null,
        confirmed: false,
        confirmedAt: null,
        attemptCount: 0,
        lastPromptedAt: null,
      }),
    });
    const loggingService = buildLoggingService();
    const service = new VoiceSmsHandoffService(conversationsService, loggingService);

    const result = await service.prepare({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      reason: "handoff",
      loggerContext: "VoiceTurnService",
    });

    expect(result.kind).toBe("prompt_confirm_ani");
    if (result.kind !== "prompt_confirm_ani") {
      throw new Error("Expected prompt_confirm_ani");
    }
    expect(result.fallbackPhone).toBe("+12167448929");
    expect(conversationsService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        phoneState: expect.objectContaining({
          value: "+12167448929",
          source: "twilio_ani",
          confirmed: false,
          lastPromptedAt: expect.any(String),
        }),
      }),
    );
    expect(conversationsService.updateVoiceSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        handoff: expect.objectContaining({
          reason: "handoff",
          messageOverride: null,
          createdAt: expect.any(String),
        }),
      }),
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_phone_ani_confirm_prompted",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        callSid: "CA123",
      }),
      "VoiceTurnService",
    );
    expect(conversationsService.clearVoiceSmsHandoff).not.toHaveBeenCalled();
  });

  it("asks for SMS phone when no fallback phone exists", async () => {
    const conversationsService = buildConversationsService({
      getConversationById: jest.fn().mockResolvedValue({
        id: "conversation-1",
        collectedData: {},
      }),
      getVoiceSmsPhoneState: jest.fn().mockReturnValue({
        value: null,
        source: null,
        confirmed: false,
        confirmedAt: null,
        attemptCount: 0,
        lastPromptedAt: null,
      }),
    });
    const loggingService = buildLoggingService();
    const service = new VoiceSmsHandoffService(conversationsService, loggingService);

    const result = await service.prepare({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      reason: "handoff",
      loggerContext: "VoiceTurnService",
    });

    expect(result.kind).toBe("prompt_ask_sms_phone");
    expect(conversationsService.updateVoiceSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        handoff: expect.objectContaining({
          reason: "handoff",
          messageOverride: null,
          createdAt: expect.any(String),
        }),
      }),
    );
    expect(conversationsService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        phoneState: expect.objectContaining({
          lastPromptedAt: expect.any(String),
        }),
      }),
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_phone_prompted",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        callSid: "CA123",
      }),
      "VoiceTurnService",
    );
    expect(conversationsService.clearVoiceSmsHandoff).not.toHaveBeenCalled();
  });

  it("marks handoff as started when SMS phone is already confirmed", async () => {
    const conversationsService = buildConversationsService({
      getVoiceSmsPhoneState: jest.fn().mockReturnValue({
        value: "+12167448929",
        source: "twilio_ani",
        confirmed: true,
        confirmedAt: "2026-01-01T00:00:00.000Z",
        attemptCount: 0,
        lastPromptedAt: null,
      }),
    });
    const loggingService = buildLoggingService();
    const service = new VoiceSmsHandoffService(conversationsService, loggingService);

    const result = await service.prepare({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      reason: "handoff",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "ready_to_close",
        resolvedSmsPhone: "+12167448929",
      }),
    );
    expect(conversationsService.clearVoiceSmsHandoff).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_handoff_started",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        callSid: "CA123",
        sms_handoff_started_at: expect.any(String),
      }),
      "VoiceTurnService",
    );
  });
});
