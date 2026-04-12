import type { VoiceConversationStateService } from "../voice-conversation-state.service";
import { VoiceUrgencySlotService } from "../voice-urgency-slot.service";

const buildVoiceConversationStateService = (
  overrides: Record<string, unknown> = {},
): VoiceConversationStateService =>
  ({
    updateVoiceUrgencyConfirmation: jest.fn().mockResolvedValue(null),
    clearVoiceListeningWindow: jest.fn().mockResolvedValue(null),
    ...overrides,
  }) as unknown as VoiceConversationStateService;

describe("VoiceUrgencySlotService", () => {
  it("returns not_applicable when expected field is not urgency related", async () => {
    const voiceConversationStateService = buildVoiceConversationStateService();
    const service = new VoiceUrgencySlotService(voiceConversationStateService);

    const result = await service.handleExpectedField({
      expectedField: null,
      binaryIntent: "YES",
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      sourceEventId: "evt-1",
    });

    expect(result).toEqual({ kind: "not_applicable" });
    expect(
      voiceConversationStateService.updateVoiceUrgencyConfirmation,
    ).not.toHaveBeenCalled();
    expect(voiceConversationStateService.clearVoiceListeningWindow).not.toHaveBeenCalled();
  });

  it("stores urgency confirmation YES and returns urgent preface", async () => {
    const voiceConversationStateService = buildVoiceConversationStateService();
    const service = new VoiceUrgencySlotService(voiceConversationStateService);

    const result = await service.handleExpectedField({
      expectedField: "comfort_risk",
      binaryIntent: "YES",
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      sourceEventId: "evt-1",
    });

    expect(result).toEqual({
      kind: "answered",
      preface: "Thanks. We'll treat this as urgent.",
    });
    expect(voiceConversationStateService.updateVoiceUrgencyConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        urgencyConfirmation: expect.objectContaining({
          response: "YES",
          sourceEventId: "evt-1",
          askedAt: expect.any(String),
        }),
      }),
    );
    expect(voiceConversationStateService.clearVoiceListeningWindow).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
  });

  it("stores urgency confirmation NO and returns standard preface", async () => {
    const voiceConversationStateService = buildVoiceConversationStateService();
    const service = new VoiceUrgencySlotService(voiceConversationStateService);

    const result = await service.handleExpectedField({
      expectedField: "urgency_confirm",
      binaryIntent: "NO",
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      sourceEventId: null,
    });

    expect(result).toEqual({
      kind: "answered",
      preface: "Okay, we'll keep it standard.",
    });
    expect(voiceConversationStateService.updateVoiceUrgencyConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        urgencyConfirmation: expect.objectContaining({
          response: "NO",
          sourceEventId: null,
          askedAt: expect.any(String),
        }),
      }),
    );
    expect(voiceConversationStateService.clearVoiceListeningWindow).toHaveBeenCalled();
  });

  it("requests reprompt when urgency answer is not binary", async () => {
    const voiceConversationStateService = buildVoiceConversationStateService();
    const service = new VoiceUrgencySlotService(voiceConversationStateService);

    const result = await service.handleExpectedField({
      expectedField: "urgency_confirm",
      binaryIntent: null,
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      sourceEventId: "evt-2",
    });

    expect(result).toEqual({ kind: "reprompt" });
    expect(
      voiceConversationStateService.updateVoiceUrgencyConfirmation,
    ).not.toHaveBeenCalled();
    expect(voiceConversationStateService.clearVoiceListeningWindow).not.toHaveBeenCalled();
  });
});
