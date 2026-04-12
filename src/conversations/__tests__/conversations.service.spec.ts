import { ConversationsService } from "../conversations.service";
import type { ConversationsRepository } from "../conversations.repository";

describe("ConversationsService", () => {
  let repository: {
    findConversationFirst: jest.Mock;
    updateConversation: jest.Mock;
  };
  let service: ConversationsService;

  beforeEach(() => {
    repository = {
      findConversationFirst: jest.fn(),
      updateConversation: jest.fn(),
    };

    service = new ConversationsService(repository as unknown as ConversationsRepository);
  });

  it("stores ai route intent in collectedData without overwriting existing fields", async () => {
    repository.findConversationFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: { sessionId: "sess-1", source: "WEBCHAT" },
    });
    repository.updateConversation.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    });

    await service.setAiRouteIntent({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      intent: "BOOKING",
    });

    expect(repository.updateConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1" },
        data: expect.objectContaining({
          collectedData: expect.objectContaining({
            sessionId: "sess-1",
            source: "WEBCHAT",
            aiRoute: expect.objectContaining({
              intent: "BOOKING",
              source: "AI_TOOL",
              updatedAt: expect.any(String),
            }),
          }),
        }),
      }),
    );
  });

  it("returns parsed defaults for voice state accessors", () => {
    const collectedData = {
      name: {
        candidate: { value: "Dean", sourceEventId: "evt-1", createdAt: "x" },
        confirmed: { value: null, sourceEventId: null, confirmedAt: null },
        status: "CANDIDATE",
        locked: false,
        attemptCount: 1,
      },
      address: {
        candidate: "123 Main St",
        confirmed: null,
        status: "CANDIDATE",
        locked: false,
        attemptCount: 1,
      },
      smsPhone: {
        value: "+12167448929",
        source: "twilio_ani",
        confirmed: false,
        confirmedAt: null,
        attemptCount: 0,
        lastPromptedAt: null,
      },
    };

    expect(service.getVoiceNameState(collectedData).candidate.value).toBe("Dean");
    expect(service.getVoiceAddressState(collectedData).candidate).toBe(
      "123 Main St",
    );
    expect(service.getVoiceSmsPhoneState(collectedData).value).toBe(
      "+12167448929",
    );
    expect(service.getVoiceSmsHandoff(collectedData)).toBeNull();
    expect(service.getVoiceComfortRisk(collectedData).response).toBeNull();
    expect(service.getVoiceUrgencyConfirmation(collectedData).response).toBeNull();
  });
});
