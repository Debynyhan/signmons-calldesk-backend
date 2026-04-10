export type VoiceExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

export type ShouldIgnoreVoiceStreamingTranscriptParams = {
  transcript: string;
  expectedField?: VoiceExpectedField | null;
  isConfirmationWindow: boolean;
  isSlowDownRequest: (value: string) => boolean;
  isFrustrationRequest: (value: string) => boolean;
  isHumanTransferRequest: (value: string) => boolean;
  isSmsDifferentNumberRequest: (value: string) => boolean;
  isHangupRequest: (value: string) => boolean;
  resolveBinaryUtterance: (value: string) => "YES" | "NO" | null;
  normalizeNameCandidate: (value: string) => string;
  isValidNameCandidate: (value: string) => boolean;
  isLikelyNameCandidate: (value: string) => boolean;
  normalizeIssueCandidate: (value: string) => string;
  isLikelyIssueCandidate: (value: string) => boolean;
  normalizeConfirmationUtterance: (value: string) => string;
  isSmsNumberConfirmation: (value: string) => boolean;
};

export function shouldIgnoreVoiceStreamingTranscript(
  params: ShouldIgnoreVoiceStreamingTranscriptParams,
): boolean {
  const normalized = params.transcript.toLowerCase().trim();
  if (!normalized) {
    return true;
  }
  if (
    params.isSlowDownRequest(normalized) ||
    params.isFrustrationRequest(normalized) ||
    params.isHumanTransferRequest(normalized) ||
    params.isSmsDifferentNumberRequest(normalized) ||
    params.isHangupRequest(normalized)
  ) {
    return false;
  }
  if (params.isConfirmationWindow) {
    return false;
  }
  // Keep yes/no utterances so late-confirmation replies are not dropped.
  if (params.resolveBinaryUtterance(normalized)) {
    return false;
  }
  if (/\d/.test(normalized)) {
    return false;
  }
  const normalizedCandidate = params.normalizeNameCandidate(normalized);
  if (
    params.isValidNameCandidate(normalizedCandidate) &&
    params.isLikelyNameCandidate(normalizedCandidate)
  ) {
    return false;
  }
  if (
    params.isLikelyIssueCandidate(params.normalizeIssueCandidate(normalized))
  ) {
    return false;
  }
  const confirmation = params.normalizeConfirmationUtterance(normalized);
  if (params.isSmsNumberConfirmation(confirmation)) {
    return false;
  }
  if (
    /(thank you for calling|this call may be recorded|this call may be transcribed|by continuing)/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    params.expectedField === "address" &&
    !/\d/.test(normalized) &&
    !/\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|pl|place|cir|circle)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/^(my address is|the address is|address is)$/.test(normalized)) {
    return true;
  }
  if (normalized.length <= 3) {
    return true;
  }
  return /\b(hold on|hang on|one sec|one second|just a sec|give me a sec|wait|um|uh|hmm|okay|ok|yeah|yep|right|sure|thanks|thank you)\b/.test(
    normalized,
  );
}
