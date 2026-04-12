import type { ConversationsService } from "../../conversations/conversations.service";
import type { LoggingService } from "../../logging/logging.service";
import type { VoiceConversationStateService } from "../voice-conversation-state.service";
import { VoiceSmsPhoneSlotService } from "../voice-sms-phone-slot.service";

const buildVoiceConversationStateService = (
  overrides: Record<string, unknown> = {},
): VoiceConversationStateService =>
  ({
    updateVoiceSmsPhoneState: jest.fn().mockResolvedValue(null),
    clearVoiceSmsHandoff: jest.fn().mockResolvedValue(null),
    clearVoiceListeningWindow: jest.fn().mockResolvedValue(null),
    ...overrides,
  }) as unknown as VoiceConversationStateService;

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

// Type alias used for ReturnType<ConversationsService["getVoiceSmsHandoff"]> in params
type SmsHandoff = ReturnType<ConversationsService["getVoiceSmsHandoff"]>;

describe("VoiceSmsPhoneSlotService", () => {
  it("returns not_waiting and clears listening window when handoff is missing", async () => {
    const voiceConversationStateService = buildVoiceConversationStateService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(loggingService, voiceConversationStateService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: null as SmsHandoff,
      phoneState: defaultPhoneState as ReturnType<ConversationsService["getVoiceSmsPhoneState"]>,
      fallbackPhone: null,
      isSameNumber: false,
      parsedPhone: null,
      sourceEventId: "evt-1",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual({ kind: "not_waiting" });
    expect(voiceConversationStateService.clearVoiceListeningWindow).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
    expect(voiceConversationStateService.updateVoiceSmsPhoneState).not.toHaveBeenCalled();
    expect(voiceConversationStateService.clearVoiceSmsHandoff).not.toHaveBeenCalled();
  });

  it("confirms ANI number and hands off when caller says same number", async () => {
    const voiceConversationStateService = buildVoiceConversationStateService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(loggingService, voiceConversationStateService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff as SmsHandoff,
      phoneState: defaultPhoneState as ReturnType<ConversationsService["getVoiceSmsPhoneState"]>,
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
    expect(voiceConversationStateService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneState: expect.objectContaining({
          value: "+12167448929",
          source: "twilio_ani",
          confirmed: true,
          confirmedAt: expect.any(String),
        }),
      }),
    );
    expect(voiceConversationStateService.clearVoiceSmsHandoff).toHaveBeenCalled();
    expect(voiceConversationStateService.clearVoiceListeningWindow).toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_phone_confirmed",
        source: "twilio_ani",
      }),
      "VoiceTurnService",
    );
  });

  it("confirms user spoken phone when parsed successfully", async () => {
    const voiceConversationStateService = buildVoiceConversationStateService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(loggingService, voiceConversationStateService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff as SmsHandoff,
      phoneState: defaultPhoneState as ReturnType<ConversationsService["getVoiceSmsPhoneState"]>,
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
    expect(voiceConversationStateService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
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
    const voiceConversationStateService = buildVoiceConversationStateService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(loggingService, voiceConversationStateService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff as SmsHandoff,
      phoneState: defaultPhoneState as ReturnType<ConversationsService["getVoiceSmsPhoneState"]>,
      fallbackPhone: null,
      isSameNumber: false,
      parsedPhone: null,
      sourceEventId: "evt-2",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual({ kind: "reprompt", sourceEventId: "evt-2" });
    expect(voiceConversationStateService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
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
    expect(voiceConversationStateService.clearVoiceSmsHandoff).not.toHaveBeenCalled();
  });

  it("defaults to fallback number after repeated parse failure", async () => {
    const voiceConversationStateService = buildVoiceConversationStateService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(loggingService, voiceConversationStateService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff as SmsHandoff,
      phoneState: {
        ...defaultPhoneState,
        attemptCount: 1,
      } as ReturnType<ConversationsService["getVoiceSmsPhoneState"]>,
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
    expect(voiceConversationStateService.clearVoiceSmsHandoff).toHaveBeenCalled();
    expect(voiceConversationStateService.clearVoiceListeningWindow).toHaveBeenCalled();
  });

  it("returns human fallback after repeated parse failure without fallback number", async () => {
    const voiceConversationStateService = buildVoiceConversationStateService();
    const loggingService = buildLoggingService();
    const service = new VoiceSmsPhoneSlotService(loggingService, voiceConversationStateService);

    const result = await service.handleExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      smsHandoff: defaultHandoff as SmsHandoff,
      phoneState: {
        ...defaultPhoneState,
        attemptCount: 1,
      } as ReturnType<ConversationsService["getVoiceSmsPhoneState"]>,
      fallbackPhone: null,
      isSameNumber: false,
      parsedPhone: null,
      sourceEventId: "evt-4",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual({ kind: "human_fallback" });
    expect(voiceConversationStateService.clearVoiceSmsHandoff).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
    expect(voiceConversationStateService.clearVoiceListeningWindow).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
  });
});
