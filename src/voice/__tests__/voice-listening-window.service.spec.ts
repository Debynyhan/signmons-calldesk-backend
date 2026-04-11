import { VoiceListeningWindowService } from "../voice-listening-window.service";
import type { VoiceListeningWindow } from "../../conversations/voice-conversation-state.codec";

const buildConversationsService = () => ({
  updateVoiceListeningWindow: jest.fn().mockResolvedValue(undefined),
  clearVoiceListeningWindow: jest.fn().mockResolvedValue(undefined),
  getVoiceNameState: jest.fn(),
  getVoiceAddressState: jest.fn(),
  getVoiceSmsPhoneState: jest.fn(),
});

const buildVoiceResponseService = () => ({
  replyWithTwiml: jest.fn().mockResolvedValue("twiml-response"),
});

const buildVoicePromptComposer = () => ({
  buildAskNameTwiml: jest.fn().mockReturnValue("ask-name"),
  buildAskSmsNumberTwiml: jest.fn().mockReturnValue("ask-sms"),
  buildBookingPromptTwiml: jest.fn().mockReturnValue("booking-prompt"),
  buildCallbackOfferTwiml: jest.fn().mockReturnValue("callback-prompt"),
  buildUrgencyConfirmTwiml: jest.fn().mockReturnValue("urgency-confirm"),
  buildRepromptTwiml: jest.fn().mockReturnValue("reprompt"),
  applyCsrStrategy: jest.fn().mockImplementation((_strategy, message) => message),
});

const buildVoiceAddressPromptService = () => ({
  buildAddressPromptForState: jest.fn().mockReturnValue("address-prompt"),
});

const buildService = (overrides: {
  conversationsService?: ReturnType<typeof buildConversationsService>;
  voiceResponseService?: ReturnType<typeof buildVoiceResponseService>;
  voicePromptComposer?: ReturnType<typeof buildVoicePromptComposer>;
  voiceAddressPromptService?: ReturnType<typeof buildVoiceAddressPromptService>;
} = {}) =>
  new VoiceListeningWindowService(
    (overrides.conversationsService ?? buildConversationsService()) as never,
    (overrides.voiceResponseService ?? buildVoiceResponseService()) as never,
    (overrides.voicePromptComposer ?? buildVoicePromptComposer()) as never,
    (overrides.voiceAddressPromptService ??
      buildVoiceAddressPromptService()) as never,
  );

const makeWindow = (
  overrides: Partial<VoiceListeningWindow> = {},
): VoiceListeningWindow => ({
  field: "name",
  sourceEventId: "evt-1",
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  ...overrides,
});

describe("VoiceListeningWindowService", () => {
  describe("getVoiceListeningWindow", () => {
    it("returns null for non-object input", () => {
      const svc = buildService();
      expect(svc.getVoiceListeningWindow(null)).toBeNull();
      expect(svc.getVoiceListeningWindow("string")).toBeNull();
    });

    it("returns null when field is invalid", () => {
      const svc = buildService();
      expect(
        svc.getVoiceListeningWindow({
          voiceListeningWindow: {
            field: "unknown",
            expiresAt: new Date().toISOString(),
          },
        }),
      ).toBeNull();
    });

    it("returns window when field and expiresAt are valid", () => {
      const svc = buildService();
      const result = svc.getVoiceListeningWindow({
        voiceListeningWindow: {
          field: "name",
          sourceEventId: "evt-1",
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
        },
      });
      expect(result).not.toBeNull();
      expect(result?.field).toBe("name");
      expect(result?.sourceEventId).toBe("evt-1");
    });

    it("includes targetField when valid", () => {
      const svc = buildService();
      const result = svc.getVoiceListeningWindow({
        voiceListeningWindow: {
          field: "confirmation",
          sourceEventId: null,
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
          targetField: "address",
        },
      });
      expect(result?.targetField).toBe("address");
    });
  });

  describe("getVoiceLastEventId", () => {
    it("returns event id from collectedData", () => {
      const svc = buildService();
      expect(
        svc.getVoiceLastEventId({ voiceLastEventId: "evt-99" }),
      ).toBe("evt-99");
    });

    it("returns null for missing or non-string value", () => {
      const svc = buildService();
      expect(svc.getVoiceLastEventId(null)).toBeNull();
      expect(svc.getVoiceLastEventId({ voiceLastEventId: 42 })).toBeNull();
    });
  });

  describe("isListeningWindowExpired", () => {
    it("returns true when window is expired", () => {
      const svc = buildService();
      const window = makeWindow({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      expect(svc.isListeningWindowExpired(window, new Date())).toBe(true);
    });

    it("returns false when window is active", () => {
      const svc = buildService();
      const window = makeWindow({
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      });
      expect(svc.isListeningWindowExpired(window, new Date())).toBe(false);
    });
  });

  describe("getExpectedListeningField", () => {
    it("returns null for null window", () => {
      const svc = buildService();
      expect(svc.getExpectedListeningField(null)).toBeNull();
    });

    it("returns targetField for confirmation windows", () => {
      const svc = buildService();
      const window = makeWindow({ field: "confirmation", targetField: "booking" });
      expect(svc.getExpectedListeningField(window)).toBe("booking");
    });

    it("returns field directly for non-confirmation windows", () => {
      const svc = buildService();
      expect(svc.getExpectedListeningField(makeWindow({ field: "address" }))).toBe("address");
    });
  });

  describe("shouldClearListeningWindow", () => {
    const nameState = { locked: false, attemptCount: 0 };
    const addressState = { locked: false, status: "CANDIDATE", attemptCount: 0 };
    const phoneState = { confirmed: false, attemptCount: 0 };

    it("returns true when window is expired", () => {
      const svc = buildService();
      const window = makeWindow({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      expect(
        svc.shouldClearListeningWindow(window, new Date(), nameState, addressState, phoneState),
      ).toBe(true);
    });

    it("returns false when name window is active and not locked", () => {
      const svc = buildService();
      const window = makeWindow({ field: "name" });
      expect(
        svc.shouldClearListeningWindow(window, new Date(), nameState, addressState, phoneState),
      ).toBe(false);
    });

    it("returns true when name is locked", () => {
      const svc = buildService();
      const window = makeWindow({ field: "name" });
      expect(
        svc.shouldClearListeningWindow(
          window,
          new Date(),
          { locked: true, attemptCount: 0 },
          addressState,
          phoneState,
        ),
      ).toBe(true);
    });
  });

  describe("buildListeningWindowReprompt", () => {
    it("returns ask-name twiml for name window", () => {
      const voicePromptComposer = buildVoicePromptComposer();
      const svc = buildService({ voicePromptComposer });
      const result = svc.buildListeningWindowReprompt({
        window: makeWindow({ field: "name" }),
        addressState: { locked: false, status: "MISSING", attemptCount: 0 } as never,
      });
      expect(result).toBe("ask-name");
      expect(voicePromptComposer.buildAskNameTwiml).toHaveBeenCalledTimes(1);
    });

    it("returns address prompt for address window", () => {
      const voiceAddressPromptService = buildVoiceAddressPromptService();
      const svc = buildService({ voiceAddressPromptService });
      const result = svc.buildListeningWindowReprompt({
        window: makeWindow({ field: "address" }),
        addressState: { locked: false, status: "CANDIDATE", attemptCount: 0 } as never,
      });
      expect(result).toBe("address-prompt");
      expect(voiceAddressPromptService.buildAddressPromptForState).toHaveBeenCalledTimes(1);
    });

    it("returns reprompt twiml for null window", () => {
      const voicePromptComposer = buildVoicePromptComposer();
      const svc = buildService({ voicePromptComposer });
      const result = svc.buildListeningWindowReprompt({
        window: null,
        addressState: {} as never,
      });
      expect(result).toBe("reprompt");
      expect(voicePromptComposer.buildRepromptTwiml).toHaveBeenCalledTimes(1);
    });

    it("returns booking twiml for booking confirmation window", () => {
      const voicePromptComposer = buildVoicePromptComposer();
      const svc = buildService({ voicePromptComposer });
      const result = svc.buildListeningWindowReprompt({
        window: makeWindow({ field: "confirmation", targetField: "booking" }),
        addressState: {} as never,
      });
      expect(result).toBe("booking-prompt");
    });
  });

  describe("replyWithListeningWindow", () => {
    it("writes listening window and calls replyWithTwiml", async () => {
      const conversationsService = buildConversationsService();
      const voiceResponseService = buildVoiceResponseService();
      const svc = buildService({ conversationsService, voiceResponseService });

      const result = await svc.replyWithListeningWindow({
        tenantId: "t1",
        conversationId: "c1",
        field: "name",
        sourceEventId: "evt-1",
        twiml: "<Response><Gather/></Response>",
      });

      expect(conversationsService.updateVoiceListeningWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t1",
          conversationId: "c1",
          window: expect.objectContaining({ field: "name", sourceEventId: "evt-1" }),
        }),
      );
      expect(voiceResponseService.replyWithTwiml).toHaveBeenCalledWith(
        undefined,
        "<Response><Gather/></Response>",
      );
      expect(result).toBe("twiml-response");
    });

    it("uses address timeout of 24s for address field", async () => {
      const conversationsService = buildConversationsService();
      const svc = buildService({ conversationsService });

      await svc.replyWithListeningWindow({
        tenantId: "t1",
        conversationId: "c1",
        field: "address",
        sourceEventId: null,
        twiml: "twiml",
      });

      const window = conversationsService.updateVoiceListeningWindow.mock.calls[0]?.[0].window;
      const expiresIn =
        new Date(window.expiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(23_000);
      expect(expiresIn).toBeLessThan(25_000);
    });
  });

  describe("clearVoiceListeningWindow", () => {
    it("delegates to conversationsService", async () => {
      const conversationsService = buildConversationsService();
      const svc = buildService({ conversationsService });

      await svc.clearVoiceListeningWindow({ tenantId: "t1", conversationId: "c1" });

      expect(conversationsService.clearVoiceListeningWindow).toHaveBeenCalledWith({
        tenantId: "t1",
        conversationId: "c1",
      });
    });
  });
});
