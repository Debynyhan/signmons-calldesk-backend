import {
  buildAddressCorrectionState,
  buildAddressExtractionBaseState,
  buildAddressExtractionCandidateState,
  buildAddressExtractionRetryState,
  buildAddressLockedCandidateState,
  buildAddressRejectedState,
  buildAddressReplacementState,
  buildAddressStateFromLocalityMerge,
  type VoiceAddressSlotState,
} from "../voice-address-slot.reducer";

const baseState: VoiceAddressSlotState = {
  candidate: "123 Main St",
  confirmed: null,
  houseNumber: "123",
  street: "Main St",
  city: null,
  state: null,
  zip: null,
  status: "CANDIDATE",
  locked: false,
  attemptCount: 0,
  confidence: 0.91,
  sourceEventId: "evt-1",
  needsLocality: true,
};

describe("voice-address-slot.reducer", () => {
  it("builds merged locality state", () => {
    const next = buildAddressStateFromLocalityMerge({
      state: baseState,
      mergedParts: { city: "Cleveland", state: "OH", zip: "44114" },
      mergedCandidate: "123 Main St Cleveland OH 44114",
      sourceEventId: "evt-2",
    });

    expect(next.city).toBe("Cleveland");
    expect(next.state).toBe("OH");
    expect(next.zip).toBe("44114");
    expect(next.needsLocality).toBe(false);
    expect(next.sourceEventId).toBe("evt-2");
  });

  it("builds correction and lock-confirm states", () => {
    const corrected = buildAddressCorrectionState({
      state: baseState,
      mergedParts: { city: "Cleveland", state: "OH" },
      mergedCandidate: "123 Main St Cleveland OH",
      sourceEventId: "evt-3",
    });

    expect(corrected.status).toBe("CANDIDATE");
    expect(corrected.needsLocality).toBe(false);

    const locked = buildAddressLockedCandidateState({
      state: corrected,
      sourceEventId: "evt-4",
    });

    expect(locked.locked).toBe(true);
    expect(locked.status).toBe("CANDIDATE");
    expect(locked.sourceEventId).toBe("evt-4");
  });

  it("builds reject and replacement transitions", () => {
    const rejected1 = buildAddressRejectedState({
      state: baseState,
      sourceEventId: "evt-5",
    });
    expect(rejected1.shouldFailClosed).toBe(false);
    expect(rejected1.state.status).toBe("MISSING");
    expect(rejected1.state.candidate).toBeNull();

    const rejected2 = buildAddressRejectedState({
      state: { ...baseState, attemptCount: 1 },
      sourceEventId: "evt-6",
    });
    expect(rejected2.shouldFailClosed).toBe(true);
    expect(rejected2.state.status).toBe("FAILED");

    const replaced1 = buildAddressReplacementState({
      state: baseState,
      replacementCandidate: "456 Oak Ave",
      sourceEventId: "evt-7",
    });
    expect(replaced1.shouldFailClosed).toBe(false);
    expect(replaced1.state.candidate).toBe("456 Oak Ave");
    expect(replaced1.state.status).toBe("CANDIDATE");

    const replaced2 = buildAddressReplacementState({
      state: { ...baseState, attemptCount: 1 },
      replacementCandidate: "456 Oak Ave",
      sourceEventId: "evt-8",
    });
    expect(replaced2.shouldFailClosed).toBe(true);
    expect(replaced2.state.status).toBe("FAILED");
  });

  it("builds extraction base/retry/candidate states", () => {
    const base = buildAddressExtractionBaseState({
      state: baseState,
      mergedParts: { city: "Cleveland", state: "OH" },
      candidate: "123 Main St Cleveland OH",
      confidence: 0.85,
      sourceEventId: "evt-9",
    });
    expect(base.city).toBe("Cleveland");
    expect(base.confidence).toBe(0.85);
    expect(base.sourceEventId).toBe("evt-9");

    const retry1 = buildAddressExtractionRetryState({
      baseState: base,
      missingLocality: true,
    });
    expect(retry1.shouldFailClosed).toBe(false);
    expect(retry1.state.status).toBe("CANDIDATE");
    expect(retry1.state.needsLocality).toBe(true);

    const retry2 = buildAddressExtractionRetryState({
      baseState: { ...base, attemptCount: 1 },
      missingLocality: true,
    });
    expect(retry2.shouldFailClosed).toBe(true);
    expect(retry2.state.status).toBe("FAILED");
    expect(retry2.state.needsLocality).toBe(false);

    const candidate = buildAddressExtractionCandidateState({
      baseState: base,
      missingLocality: false,
    });
    expect(candidate.status).toBe("CANDIDATE");
    expect(candidate.needsLocality).toBe(false);
  });
});
