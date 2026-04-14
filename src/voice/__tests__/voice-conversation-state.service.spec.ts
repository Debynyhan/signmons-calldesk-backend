import { SanitizationService } from "../../sanitization/sanitization.service";
import { VoiceConversationStateService } from "../../conversations/voice-conversation-state.service";

describe("VoiceConversationStateService", () => {
  let repository: {
    findConversationFirst: jest.Mock;
    updateConversation: jest.Mock;
  };
  let service: VoiceConversationStateService;

  beforeEach(() => {
    repository = {
      findConversationFirst: jest.fn(),
      updateConversation: jest.fn(),
    };
    service = new VoiceConversationStateService(
      repository as never,
      new SanitizationService(),
    );
  });

  it("stores normalized transcript on voice turn", async () => {
    repository.findConversationFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: { voiceConsent: { granted: true } },
    });
    repository.updateConversation.mockResolvedValue({ id: "conv-1" });

    await service.updateVoiceTranscript({
      tenantId: "tenant-1",
      callSid: "CA123",
      transcript: "  no   heat  ",
    });

    expect(repository.updateConversation).toHaveBeenCalledWith(
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
    repository.findConversationFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    });
    repository.updateConversation.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    });

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

    expect(repository.updateConversation).toHaveBeenCalledWith(
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
    repository.findConversationFirst.mockResolvedValue({
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
    });
    repository.updateConversation.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    });

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

    expect(repository.updateConversation).toHaveBeenCalledWith(
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
    repository.findConversationFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: {
        name: {
          candidate: {
            value: "Dean Banks",
            sourceEventId: "evt-1",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          confirmed: { value: null, sourceEventId: null, confirmedAt: null },
          status: "CANDIDATE",
          locked: true,
          attemptCount: 1,
        },
      },
    });
    repository.updateConversation.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    });

    await service.promoteNameFromSms({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      value: "Dean Banks",
      sourceEventId: "sms-1",
      confirmedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(repository.updateConversation).toHaveBeenCalledWith(
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
    repository.findConversationFirst.mockResolvedValue({
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
    });
    repository.updateConversation.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    });

    await service.promoteAddressFromSms({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      value: "123 Main St",
      sourceEventId: "sms-addr-1",
      confirmedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(repository.updateConversation).toHaveBeenCalledWith(
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

  it("appends voice turn timing snapshots with bounded history", async () => {
    repository.findConversationFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: {
        voiceTurnTimings: [{ reason: "first" }, { reason: "second" }],
      },
    });
    repository.updateConversation.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    });

    await service.appendVoiceTurnTiming({
      tenantId: "tenant-1",
      callSid: "CA123",
      maxHistory: 2,
      timing: {
        sttFinalMs: 35,
        queueDelayMs: 5,
        turnLogicMs: 210,
        aiMs: 120,
        aiCalls: 1,
        ttsMs: 40,
        twilioUpdateMs: 18,
        transcriptChars: 16,
        reason: "twiml_updated",
        twilioUpdated: true,
        usedGoogleTts: false,
        ttsCacheHit: false,
        ttsPolicy: "twilio_say",
        hangup: false,
      },
    });

    expect(repository.updateConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1" },
        data: expect.objectContaining({
          collectedData: expect.objectContaining({
            lastVoiceTurnTiming: expect.objectContaining({
              reason: "twiml_updated",
              recordedAt: expect.any(String),
            }),
            voiceTurnTimings: [
              expect.objectContaining({ reason: "second" }),
              expect.objectContaining({ reason: "twiml_updated" }),
            ],
          }),
        }),
      }),
    );
  });
});
