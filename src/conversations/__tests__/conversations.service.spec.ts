import { ConversationsService } from "../conversations.service";
import type { ConversationsRepository } from "../conversations.repository";

describe("ConversationsService", () => {
  let repository: {
    findConversationFirst: jest.Mock;
    updateConversation: jest.Mock;
    findCustomerFirst: jest.Mock;
    createCustomer: jest.Mock;
    updateCustomer: jest.Mock;
  };
  let service: ConversationsService;

  beforeEach(() => {
    repository = {
      findConversationFirst: jest.fn(),
      updateConversation: jest.fn(),
      findCustomerFirst: jest.fn(),
      createCustomer: jest.fn(),
      updateCustomer: jest.fn(),
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

  it("reads sms consent state by phone", async () => {
    repository.findCustomerFirst.mockResolvedValueOnce({ consentToText: true });
    repository.findCustomerFirst.mockResolvedValueOnce(null);

    await expect(
      service.getSmsConsentByPhone({
        tenantId: "tenant-1",
        phone: "+12167448929",
      }),
    ).resolves.toBe(true);

    await expect(
      service.getSmsConsentByPhone({
        tenantId: "tenant-1",
        phone: "+12165550000",
      }),
    ).resolves.toBeNull();
  });

  it("updates existing sms consent state when changed", async () => {
    repository.findCustomerFirst.mockResolvedValue({
      id: "customer-1",
      consentToText: false,
      consentToTextAt: null,
    });

    await service.setSmsConsentByPhone({
      tenantId: "tenant-1",
      phone: "+12167448929",
      consent: true,
    });

    expect(repository.updateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "customer-1" },
        data: expect.objectContaining({
          consentToText: true,
          consentToTextAt: expect.any(Date),
        }),
      }),
    );
    expect(repository.createCustomer).not.toHaveBeenCalled();
  });

  it("creates an sms contact record when none exists", async () => {
    repository.findCustomerFirst.mockResolvedValue(null);
    repository.createCustomer.mockResolvedValue({ id: "customer-1" });

    await service.setSmsConsentByPhone({
      tenantId: "tenant-1",
      phone: "+12167448929",
      consent: false,
    });

    expect(repository.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          phone: "+12167448929",
          consentToText: false,
        }),
      }),
    );
  });
});
