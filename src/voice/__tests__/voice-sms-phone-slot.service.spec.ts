import type { ConversationsService } from "../../conversations/conversations.service";
import type { LoggingService } from "../../logging/logging.service";
import { VoiceSmsPhoneSlotService } from "../voice-sms-phone-slot.service";

const buildConversationsService = (
  overrides: Record<string, unknown> = {},
): ConversationsService =>
  ({
    updateVoiceSmsPhoneState: jest.fn().mockResolvedValue(null),
    clearVoiceSmsHandoff: jest.fn().mockResolvedValue(null),
    clearVoiceListeningWindow: jest.fn().mockResolvedValue(null),
    ...overrides,
  }) as unknown as ConversationsService;

const buildLoggingService = (
  overrides: Record<string, unknown> = {},
): LoggingService =>
  ({
    log: jest.fn(),
    warn: jest.fn(),
    ...overrides,
  }) as unknown as LoggingService;

const defaultPhoneState = {
  value: null,
  source: null,
  confirmed: false,
  confirmedAt: null,
  attemptCount: 0,
  lastPromptedAt: null,
};

const defaultHandoff = {
  reason: "intake_complete",
  messageOverride: null,
  createdAt: "2026-04-09T16:20:00.000Z",
};

describe("VoiceSmsPhoneSlotService", () => {
  it("returns not_waiting and clears listening window when handoff is missing", async () => {
    const conversationsService = buildConversationsService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(conversationsService, loggingService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: null,
      phoneState: defaultPhoneState,
      fallbackPhone: null,
      isSameNumber: false,
      parsedPhone: null,
      sourceEventId: "evt-1",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual({ kind: "not_waiting" });
    expect(conversationsService.clearVoiceListeningWindow).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
    expect(conversationsService.updateVoiceSmsPhoneState).not.toHaveBeenCalled();
    expect(conversationsService.clearVoiceSmsHandoff).not.toHaveBeenCalled();
  });

  it("confirms ANI number and hands off when caller says same number", async () => {
    const conversationsService = buildConversationsService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(conversationsService, loggingService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff,
      phoneState: defaultPhoneState,
      fallbackPhone: "+12167448929",
      isSameNumber: true,
      parsedPhone: null,
      sourceEventId: "evt-1",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual({
      kind: "handoff",
      reason: "intake_complete",
      messageOverride: undefined,
    });
    expect(conversationsService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneState: expect.objectContaining({
          value: "+12167448929",
          source: "twilio_ani",
          confirmed: true,
          confirmedAt: expect.any(String),
        }),
      }),
    );
    expect(conversationsService.clearVoiceSmsHandoff).toHaveBeenCalled();
    expect(conversationsService.clearVoiceListeningWindow).toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_phone_confirmed",
        source: "twilio_ani",
      }),
      "VoiceTurnService",
    );
  });

  it("confirms user spoken phone when parsed successfully", async () => {
    const conversationsService = buildConversationsService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(conversationsService, loggingService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff,
      phoneState: defaultPhoneState,
      fallbackPhone: "+12167448929",
      isSameNumber: false,
      parsedPhone: "+12165551234",
      sourceEventId: "evt-1",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual({
      kind: "handoff",
      reason: "intake_complete",
      messageOverride: undefined,
    });
    expect(conversationsService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneState: expect.objectContaining({
          value: "+12165551234",
          source: "user_spoken",
          confirmed: true,
          confirmedAt: expect.any(String),
        }),
      }),
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_phone_confirmed",
        source: "user_spoken",
      }),
      "VoiceTurnService",
    );
  });

  it("reprompts on first parse failure", async () => {
    const conversationsService = buildConversationsService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(conversationsService, loggingService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff,
      phoneState: defaultPhoneState,
      fallbackPhone: null,
      isSameNumber: false,
      parsedPhone: null,
      sourceEventId: "evt-2",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual({ kind: "reprompt", sourceEventId: "evt-2" });
    expect(conversationsService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneState: expect.objectContaining({
          attemptCount: 1,
          lastPromptedAt: expect.any(String),
        }),
      }),
    );
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_phone_parse_failed",
        attemptCount: 1,
      }),
      "VoiceTurnService",
    );
    expect(conversationsService.clearVoiceSmsHandoff).not.toHaveBeenCalled();
  });

  it("defaults to fallback number after repeated parse failure", async () => {
    const conversationsService = buildConversationsService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(conversationsService, loggingService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff,
      phoneState: { ...defaultPhoneState, attemptCount: 1 },
      fallbackPhone: "+12167448929",
      isSameNumber: false,
      parsedPhone: null,
      sourceEventId: "evt-3",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual({
      kind: "handoff",
      reason: "intake_complete",
      messageOverride: undefined,
    });
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_phone_defaulted",
      }),
      "VoiceTurnService",
    );
    expect(conversationsService.clearVoiceSmsHandoff).toHaveBeenCalled();
    expect(conversationsService.clearVoiceListeningWindow).toHaveBeenCalled();
  });

  it("returns human fallback after repeated parse failure without fallback number", async () => {
    const conversationsService = buildConversationsService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(conversationsService, loggingService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff,
      phoneState: { ...defaultPhoneState, attemptCount: 1 },
      fallbackPhone: null,
      isSameNumber: false,
      parsedPhone: null,
      sourceEventId: "evt-4",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual({ kind: "human_fallback" });
    expect(conversationsService.clearVoiceSmsHandoff).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
    expect(conversationsService.clearVoiceListeningWindow).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
  });
});
