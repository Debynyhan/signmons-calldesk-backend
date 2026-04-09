import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { ConversationsService } from "../conversations/conversations.service";
import type { CsrStrategy } from "./csr-strategy.selector";

type VoiceListeningField =
  | "name"
  | "address"
  | "confirmation"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

type VoiceNameState = ReturnType<ConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  ConversationsService["getVoiceAddressState"]
>;
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

type SideQuestionRoutingPolicy = {
  replyWithSideQuestionAndContinue: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sideQuestionReply: string;
    expectedField: VoiceListeningField | null;
    nameReady: boolean;
    addressReady: boolean;
    addressState: VoiceAddressState;
    currentEventId: string | null;
    strategy?: CsrStrategy;
  }) => Promise<string | null>;
  getVoiceIssueCandidate: (
    collectedData: Prisma.JsonValue | null,
  ) => { value?: string; sourceEventId?: string } | null;
  clearIssuePromptAttempts: (callSid: string) => void;
  shouldDiscloseFees: (params: {
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: Prisma.JsonValue | null;
    currentSpeech?: string;
  }) => boolean;
  getTenantFeePolicySafe: (tenantId: string) => Promise<unknown | null>;
  buildSmsHandoffMessageForContext: (params: {
    feePolicy: unknown | null;
    includeFees: boolean;
    isEmergency: boolean;
    callerFirstName?: string;
  }) => string;
  isUrgencyEmergency: (collectedData: Prisma.JsonValue | null) => boolean;
  getVoiceNameCandidate: (nameState: VoiceNameState) => string | null;
  replyWithSmsHandoff: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    reason: string;
    messageOverride?: string;
  }) => Promise<string>;
  replyWithIssueCaptureRecovery: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: Prisma.JsonValue | null;
    strategy?: CsrStrategy;
    reason: string;
    promptPrefix?: string;
    transcript?: string;
  }) => Promise<string>;
  replyWithTwiml: (res: Response | undefined, twiml: string) => Promise<string>;
  buildSayGatherTwiml: (message: string) => string;
};

export class VoiceTurnSideQuestionRoutingRuntime {
  constructor(private readonly policy: SideQuestionRoutingPolicy) {}

  async continueAfterSideQuestionWithIssueRouting(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    sideQuestionReply: string;
    expectedField: VoiceListeningField | null;
    nameReady: boolean;
    addressReady: boolean;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: Prisma.JsonValue | null;
    currentEventId: string | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string> {
    const followUp = await this.policy.replyWithSideQuestionAndContinue({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      sideQuestionReply: params.sideQuestionReply,
      expectedField: params.expectedField,
      nameReady: params.nameReady,
      addressReady: params.addressReady,
      addressState: params.addressState,
      currentEventId: params.currentEventId,
      strategy: params.strategy,
    });
    if (followUp) {
      return followUp;
    }

    if (params.nameReady && params.addressReady) {
      const issueCandidate = this.policy.getVoiceIssueCandidate(params.collectedData);
      if (issueCandidate?.value) {
        this.policy.clearIssuePromptAttempts(params.callSid);
        const includeFees = this.policy.shouldDiscloseFees({
          nameState: params.nameState,
          addressState: params.addressState,
          collectedData: params.collectedData,
        });
        const feePolicy = includeFees
          ? await this.policy.getTenantFeePolicySafe(params.tenantId)
          : null;
        const smsMessage = this.policy.buildSmsHandoffMessageForContext({
          feePolicy,
          includeFees,
          isEmergency: this.policy.isUrgencyEmergency(params.collectedData),
          callerFirstName: this.policy
            .getVoiceNameCandidate(params.nameState)
            ?.split(" ")
            .filter(Boolean)[0],
        });
        return this.policy.replyWithSmsHandoff({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          reason: "post_side_question_sms_handoff",
          messageOverride: smsMessage,
        });
      }
      return this.policy.replyWithIssueCaptureRecovery({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        nameState: params.nameState,
        addressState: params.addressState,
        collectedData: params.collectedData,
        strategy: params.strategy,
        reason: "missing_issue_post_side_question",
      });
    }

    return this.policy.replyWithTwiml(
      params.res,
      this.policy.buildSayGatherTwiml("How can I help?"),
    );
  }
}
