import type { IConversationsService } from "../conversations/conversations.service.interface";
import { VoiceTurnPreludeRuntime } from "./voice-turn-prelude.runtime";
import { VoiceTurnContextRuntime } from "./voice-turn-context.runtime";
import { VoiceTurnEarlyRoutingRuntime } from "./voice-turn-early-routing.runtime";
import { VoiceTurnExpectedFieldRuntime } from "./voice-turn-expected-field.runtime";
import { VoiceTurnIssueRecoveryRuntime } from "./voice-turn-issue-recovery.runtime";
import { VoiceTurnInterruptRuntime } from "./voice-turn-interrupt.runtime";
import { VoiceTurnAiTriageRuntime } from "./voice-turn-ai-triage.runtime";
import { VoiceTurnNameOpeningRuntime } from "./voice-turn-name-opening.runtime";
import { VoiceTurnNameCaptureRuntime } from "./voice-turn-name-capture.runtime";
import { VoiceTurnNameFlowRuntime } from "./voice-turn-name-flow.runtime";
import { VoiceTurnNameSpellingRuntime } from "./voice-turn-name-spelling.runtime";
import { VoiceTurnAddressExtractionRuntime } from "./voice-turn-address-extraction.runtime";
import { VoiceTurnAddressRoutingRuntime } from "./voice-turn-address-routing.runtime";
import { VoiceTurnAddressCompletenessRuntime } from "./voice-turn-address-completeness.runtime";
import { VoiceTurnAddressExistingCandidateRuntime } from "./voice-turn-address-existing-candidate.runtime";
import { VoiceTurnAddressConfirmedRuntime } from "./voice-turn-address-confirmed.runtime";
import { VoiceTurnSideQuestionHelperRuntime } from "./voice-turn-side-question-helper.runtime";
import { VoiceTurnSideQuestionRoutingRuntime } from "./voice-turn-side-question-routing.runtime";
import { VoiceTurnSideQuestionRuntime } from "./voice-turn-side-question.runtime";
import { VoiceTurnHandoffRuntime } from "./voice-turn-handoff.runtime";

export const LOGGER_CONTEXT = "VoiceTurnService";

export type VoiceListeningField =
  | "name"
  | "address"
  | "confirmation"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

export type VoiceExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

export type VoiceListeningWindow = {
  field: VoiceListeningField;
  sourceEventId: string | null;
  expiresAt: string;
  targetField?:
    | "name"
    | "address"
    | "booking"
    | "callback"
    | "comfort_risk"
    | "urgency_confirm";
};

export type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

export type VoiceNameState = ReturnType<
  IConversationsService["getVoiceNameState"]
>;
export type VoiceAddressState = ReturnType<
  IConversationsService["getVoiceAddressState"]
>;

export type VoiceTurnRuntimeSet = {
  turnPreludeRuntime: VoiceTurnPreludeRuntime;
  turnContextRuntime: VoiceTurnContextRuntime;
  turnEarlyRoutingRuntime: VoiceTurnEarlyRoutingRuntime;
  turnExpectedFieldRuntime: VoiceTurnExpectedFieldRuntime;
  turnIssueRecoveryRuntime: VoiceTurnIssueRecoveryRuntime;
  turnInterruptRuntime: VoiceTurnInterruptRuntime;
  turnAiTriageRuntime: VoiceTurnAiTriageRuntime;
  turnNameOpeningRuntime: VoiceTurnNameOpeningRuntime;
  turnNameCaptureRuntime: VoiceTurnNameCaptureRuntime;
  turnNameFlowRuntime: VoiceTurnNameFlowRuntime;
  turnNameSpellingRuntime: VoiceTurnNameSpellingRuntime;
  turnAddressExtractionRuntime: VoiceTurnAddressExtractionRuntime;
  turnAddressRoutingRuntime: VoiceTurnAddressRoutingRuntime;
  turnAddressCompletenessRuntime: VoiceTurnAddressCompletenessRuntime;
  turnAddressExistingCandidateRuntime: VoiceTurnAddressExistingCandidateRuntime;
  turnAddressConfirmedRuntime: VoiceTurnAddressConfirmedRuntime;
  turnSideQuestionHelperRuntime: VoiceTurnSideQuestionHelperRuntime;
  turnSideQuestionRoutingRuntime: VoiceTurnSideQuestionRoutingRuntime;
  turnSideQuestionRuntime: VoiceTurnSideQuestionRuntime;
  turnHandoffRuntime: VoiceTurnHandoffRuntime;
};
