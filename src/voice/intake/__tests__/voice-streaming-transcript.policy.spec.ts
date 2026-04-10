import { shouldIgnoreVoiceStreamingTranscript } from "../voice-streaming-transcript.policy";

const baseParams = () => ({
  transcript: "hello there",
  expectedField: null,
  isConfirmationWindow: false,
  isSlowDownRequest: () => false,
  isFrustrationRequest: () => false,
  isHumanTransferRequest: () => false,
  isSmsDifferentNumberRequest: () => false,
  isHangupRequest: () => false,
  resolveBinaryUtterance: () => null,
  normalizeNameCandidate: (value: string) => value,
  isValidNameCandidate: () => false,
  isLikelyNameCandidate: () => false,
  normalizeIssueCandidate: (value: string) => value,
  isLikelyIssueCandidate: () => false,
  normalizeConfirmationUtterance: (value: string) => value,
  isSmsNumberConfirmation: () => false,
});

describe("voice-streaming-transcript.policy", () => {
  it("ignores empty transcripts", () => {
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "   ",
      }),
    ).toBe(true);
  });

  it("keeps interruption intents", () => {
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "slow down please",
        isSlowDownRequest: () => true,
      }),
    ).toBe(false);
  });

  it("keeps transcripts during confirmation windows", () => {
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        isConfirmationWindow: true,
      }),
    ).toBe(false);
  });

  it("keeps binary utterances and numeric input", () => {
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "yes",
        resolveBinaryUtterance: () => "YES",
      }),
    ).toBe(false);
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "123 main street",
      }),
    ).toBe(false);
  });

  it("keeps likely name and issue candidates", () => {
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "david smith",
        isValidNameCandidate: () => true,
        isLikelyNameCandidate: () => true,
      }),
    ).toBe(false);
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "no heat in house",
        isLikelyIssueCandidate: () => true,
      }),
    ).toBe(false);
  });

  it("ignores compliance and filler utterances", () => {
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "thank you for calling",
      }),
    ).toBe(true);
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "okay",
      }),
    ).toBe(true);
  });

  it("ignores low-signal address utterances while waiting for address", () => {
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "i'm here now",
        expectedField: "address",
      }),
    ).toBe(true);
  });

  it("keeps normal non-filler transcript", () => {
    expect(
      shouldIgnoreVoiceStreamingTranscript({
        ...baseParams(),
        transcript: "the blower is noisy",
      }),
    ).toBe(false);
  });
});
