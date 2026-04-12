import type { Response } from "express";
import type { Prisma, TenantOrganization } from "@prisma/client";
import type { CsrStrategy } from "./csr-strategy.selector";
import type {
  VoiceNameState,
  VoiceSmsPhoneState,
  VoiceAddressState,
  VoiceUrgencyConfirmation,
} from "../conversations/voice-conversation-state.codec";
import type { VoiceTurnPlannerAction } from "./intake/voice-turn-planner.reducer";

export type VoiceExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

export type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

export type TurnConversationShape = {
  id: string;
  collectedData: Prisma.JsonValue | null;
  currentFSMState?: string | null;
};

export type VoiceTurnStepContext = {
  // Input — always present from the start of a turn
  res: Response | undefined;
  tenant: TenantOrganization;
  callSid: string;
  requestId: string | undefined;
  timingCollector: VoiceTurnTimingCollector | undefined;
  speechResult: string | null;
  rawConfidence: string | number | null;

  // Populated by PreludeStep
  now?: Date;
  normalizedSpeech?: string;
  confidence?: number;
  voiceTurnCount?: number;
  displayName?: string;
  currentEventId?: string;
  conversation?: TurnConversationShape;
  updatedConversation?: TurnConversationShape | null;
  conversationId?: string;
  collectedData?: Prisma.JsonValue | null;

  // Populated by ContextStep; some fields are mutable across later steps
  nameState?: VoiceNameState;
  phoneState?: VoiceSmsPhoneState;
  addressState?: VoiceAddressState;
  csrStrategy?: CsrStrategy | undefined;
  expectedField?: VoiceExpectedField | null;
  nameReady?: boolean;
  addressReady?: boolean;

  // Populated by IssueCandidateStep (nameState / nameReady may also be updated)
  existingIssueCandidate?: { value?: string; sourceEventId?: string } | null;
  issueCandidate?: string;
  hasIssueCandidate?: boolean;
  openingAddressPreface?: string | null;

  // Populated by AddressFieldHeuristicStep (expectedField may also be updated)
  yesNoIntent?: string | null;

  // Populated by TurnPlanStep
  urgencyConfirmation?: VoiceUrgencyConfirmation;
  emergencyIssueContext?: string;
  emergencyRelevant?: boolean;
  isQuestionUtterance?: boolean;
  turnPlan?: VoiceTurnPlannerAction;
  shouldAskUrgencyConfirm?: boolean;
};

export type VoiceTurnStepResult =
  | { kind: "exit"; value: unknown }
  | { kind: "continue"; ctx: VoiceTurnStepContext };

export interface IVoiceTurnStep {
  execute(ctx: VoiceTurnStepContext): Promise<VoiceTurnStepResult>;
}
