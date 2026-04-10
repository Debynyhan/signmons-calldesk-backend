import {
  buildVoiceListeningWindowReprompt,
  getExpectedVoiceListeningField,
  isVoiceListeningWindowExpired,
  shouldClearVoiceListeningWindow,
} from "../voice-listening-window.policy";

describe("voice-listening-window.policy", () => {
  it("resolves expected field from confirmation target", () => {
    expect(
      getExpectedVoiceListeningField({
        field: "confirmation",
        sourceEventId: "evt-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        targetField: "callback",
      }),
    ).toBe("callback");
  });

  it("detects expired listening windows", () => {
    expect(
      isVoiceListeningWindowExpired(
        {
          field: "name",
          sourceEventId: "evt-1",
          expiresAt: "2000-01-01T00:00:00.000Z",
        },
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("clears name windows when locked or retries are exhausted", () => {
    expect(
      shouldClearVoiceListeningWindow({
        window: {
          field: "name",
          sourceEventId: "evt-1",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        now: new Date("2026-01-01T00:00:00.000Z"),
        nameState: { locked: true, attemptCount: 0 },
        addressState: { locked: false, status: "MISSING", attemptCount: 0 },
        phoneState: { confirmed: false, attemptCount: 0 },
      }),
    ).toBe(true);
  });

  it("clears address windows for failed or exhausted address state", () => {
    expect(
      shouldClearVoiceListeningWindow({
        window: {
          field: "address",
          sourceEventId: "evt-2",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        now: new Date("2026-01-01T00:00:00.000Z"),
        nameState: { locked: false, attemptCount: 0 },
        addressState: { locked: false, status: "FAILED", attemptCount: 0 },
        phoneState: { confirmed: false, attemptCount: 0 },
      }),
    ).toBe(true);
  });

  it("clears sms_phone windows when confirmed", () => {
    expect(
      shouldClearVoiceListeningWindow({
        window: {
          field: "sms_phone",
          sourceEventId: "evt-3",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        now: new Date("2026-01-01T00:00:00.000Z"),
        nameState: { locked: false, attemptCount: 0 },
        addressState: { locked: false, status: "MISSING", attemptCount: 0 },
        phoneState: { confirmed: true, attemptCount: 0 },
      }),
    ).toBe(true);
  });

  it("maps reprompt twiml by expected field", () => {
    const reprompt = buildVoiceListeningWindowReprompt({
      window: {
        field: "confirmation",
        sourceEventId: "evt-4",
        expiresAt: "2099-01-01T00:00:00.000Z",
        targetField: "booking",
      },
      addressState: { status: "MISSING" },
      strategy: "WARM",
      buildAskNameTwiml: () => "ask-name",
      buildAddressPromptForState: () => "ask-address",
      buildAskSmsNumberTwiml: () => "ask-sms",
      buildBookingPromptTwiml: () => "ask-booking",
      buildCallbackOfferTwiml: () => "ask-callback",
      buildUrgencyConfirmTwiml: () => "ask-urgency",
      buildRepromptTwiml: () => "ask-generic",
    });

    expect(reprompt).toBe("ask-booking");
  });
});
