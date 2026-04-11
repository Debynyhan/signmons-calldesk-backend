import {
  getDefaultVoiceAddressState,
  getDefaultVoiceNameState,
  getDefaultVoiceSmsPhoneState,
  getVoiceAddressStateFromCollectedData,
  getVoiceComfortRiskFromCollectedData,
  getVoiceSmsPhoneStateFromCollectedData,
  getVoiceUrgencyConfirmationFromCollectedData,
  mergeLockedVoiceAddressState,
  mergeLockedVoiceNameState,
  parseVoiceAddressState,
} from "../voice-conversation-state.codec";

describe("voice-conversation-state.codec", () => {
  it("returns stable defaults for empty inputs", () => {
    expect(getDefaultVoiceNameState()).toEqual(
      expect.objectContaining({
        status: "MISSING",
        locked: false,
        attemptCount: 0,
      }),
    );
    expect(getDefaultVoiceAddressState()).toEqual(
      expect.objectContaining({
        status: "MISSING",
        locked: false,
        needsLocality: false,
      }),
    );
    expect(getDefaultVoiceSmsPhoneState(null)).toEqual(
      expect.objectContaining({
        value: null,
        source: null,
        confirmed: false,
      }),
    );
  });

  it("parses legacy address object candidate/confirmed shapes", () => {
    const parsed = parseVoiceAddressState({
      candidate: { value: "123 Main St", sourceEventId: "evt-candidate" },
      confirmed: { value: "123 Main St", sourceEventId: "evt-confirmed" },
      status: "CONFIRMED",
      locked: true,
      attemptCount: 2,
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        candidate: "123 Main St",
        confirmed: "123 Main St",
        status: "CONFIRMED",
        locked: true,
        sourceEventId: "evt-candidate",
      }),
    );
  });

  it("falls back sms phone to callerPhone when smsPhone is missing", () => {
    const state = getVoiceSmsPhoneStateFromCollectedData({
      callerPhone: "+12165550000",
    });

    expect(state).toEqual(
      expect.objectContaining({
        value: "+12165550000",
        source: "twilio_ani",
        confirmed: false,
      }),
    );
  });

  it("reads comfort risk and urgency confirmation safely", () => {
    const collectedData = {
      voiceComfortRisk: {
        askedAt: "2026-04-01T00:00:00.000Z",
        response: "YES",
        sourceEventId: "evt-1",
      },
      voiceUrgencyConfirmation: {
        askedAt: "2026-04-01T00:00:01.000Z",
        response: "NO",
        sourceEventId: "evt-2",
      },
    };

    expect(getVoiceComfortRiskFromCollectedData(collectedData)).toEqual({
      askedAt: "2026-04-01T00:00:00.000Z",
      response: "YES",
      sourceEventId: "evt-1",
    });
    expect(getVoiceUrgencyConfirmationFromCollectedData(collectedData)).toEqual(
      {
        askedAt: "2026-04-01T00:00:01.000Z",
        response: "NO",
        sourceEventId: "evt-2",
      },
    );
  });

  it("keeps locked confirmed states immutable during merge", () => {
    const lockedName = {
      ...getDefaultVoiceNameState(),
      status: "CONFIRMED" as const,
      locked: true,
      confirmed: {
        value: "Taylor Smith",
        sourceEventId: "evt-locked",
        confirmedAt: "2026-04-01T00:00:00.000Z",
      },
    };
    const nextName = {
      ...getDefaultVoiceNameState(),
      status: "CANDIDATE" as const,
      candidate: {
        value: "Different Name",
        sourceEventId: "evt-next",
        createdAt: "2026-04-01T00:00:02.000Z",
      },
    };

    const lockedAddress = {
      ...getDefaultVoiceAddressState(),
      status: "CONFIRMED" as const,
      locked: true,
      confirmed: "123 Main St",
    };
    const nextAddress = {
      ...getDefaultVoiceAddressState(),
      status: "CANDIDATE" as const,
      candidate: "999 Other St",
    };

    expect(mergeLockedVoiceNameState(lockedName, nextName)).toEqual(
      expect.objectContaining({
        status: "CONFIRMED",
        confirmed: lockedName.confirmed,
      }),
    );
    expect(mergeLockedVoiceAddressState(lockedAddress, nextAddress)).toEqual(
      expect.objectContaining({
        status: "CONFIRMED",
        confirmed: "123 Main St",
      }),
    );
  });

  it("extracts address from collectedData using parser defaults", () => {
    const address = getVoiceAddressStateFromCollectedData({
      address: { candidate: "321 Oak Ave", status: "CANDIDATE" },
    });

    expect(address).toEqual(
      expect.objectContaining({
        candidate: "321 Oak Ave",
        status: "CANDIDATE",
      }),
    );
  });
});
