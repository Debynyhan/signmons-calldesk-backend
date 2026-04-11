import { ConversationsService } from "../conversations.service";
import type { PrismaService } from "../../prisma/prisma.service";

describe("ConversationsService", () => {
  let prisma: {
    conversation: { findFirst: jest.Mock; update: jest.Mock };
  };
  let service: ConversationsService;

  beforeEach(() => {
    prisma = {
      conversation: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new ConversationsService(prisma as unknown as PrismaService);
  });

  it("stores ai route intent in collectedData without overwriting existing fields", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      collectedData: { sessionId: "sess-1", source: "WEBCHAT" },
    } as never);
    prisma.conversation.update.mockResolvedValue({
      id: "conv-1",
      collectedData: {},
    } as never);

    await service.setAiRouteIntent({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      intent: "BOOKING",
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith(
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
