import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { ConversationsService } from "../conversations/conversations.service";
import { getRequestContext } from "../common/context/request-context";
import {
  buildIssueSlotPrompt,
  ISSUE_SLOT_SMS_DEFER_MESSAGE,
} from "./intake/issue-slot.policy";
import { reduceIssueSlot } from "./intake/voice-intake.reducer";
import type { CsrStrategy } from "./csr-strategy.selector";

type VoiceNameState = ReturnType<ConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  ConversationsService["getVoiceAddressState"]
>;

type IssueRecoveryPolicy = {
  getVoiceIssueCandidate: (
    collectedData: Prisma.JsonValue | null,
  ) => { value?: string; sourceEventId?: string } | null;
  normalizeIssueCandidate: (value: string) => string;
  buildFallbackIssueCandidate: (value: string) => string | null;
  isLikelyIssueCandidate: (value: string) => boolean;
  getIssuePromptAttempts: (callSid: string) => number;
  setIssuePromptAttempts: (callSid: string, count: number) => void;
  clearIssuePromptAttempts: (callSid: string) => void;
  isLikelyQuestion: (value: string) => boolean;
  updateVoiceIssueCandidate: (params: {
    tenantId: string;
    conversationId: string;
    issue: {
      value: string;
      sourceEventId: string;
      createdAt: string;
    };
  }) => Promise<{ id: string; collectedData: Prisma.JsonValue } | null>;
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
  log: (
    payload: Record<string, unknown>,
    context: string,
  ) => void | Promise<void>;
  buildSayGatherTwiml: (message: string) => string;
  applyCsrStrategy: (strategy: CsrStrategy | undefined, message: string) => string;
  replyWithTwiml: (res: Response | undefined, twiml: string) => Promise<string>;
  loggerContext: string;
};

export class VoiceTurnIssueRecoveryRuntime {
  constructor(private readonly policy: IssueRecoveryPolicy) {}

  async replyWithIssueCaptureRecovery(params: {
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
  }): Promise<string> {
    const existingIssueCandidate =
      this.policy.getVoiceIssueCandidate(params.collectedData)?.value ?? null;
    const existingIssue = existingIssueCandidate
      ? this.policy.normalizeIssueCandidate(existingIssueCandidate)
      : null;
    const detectedIssueCandidate = this.policy.normalizeIssueCandidate(
      params.transcript ?? "",
    );
    const fallbackIssue = this.policy.buildFallbackIssueCandidate(
      params.transcript ?? "",
    );
    const detectedIssue = this.policy.isLikelyIssueCandidate(detectedIssueCandidate)
      ? detectedIssueCandidate
      : fallbackIssue;
    const askCount = this.policy.getIssuePromptAttempts(params.callSid);
    const decision = reduceIssueSlot(
      {
        status: existingIssue ? "CAPTURED" : "MISSING",
        value: existingIssue,
        askCount,
      },
      {
        existingIssue,
        detectedIssue,
        isQuestion: this.policy.isLikelyQuestion(params.transcript ?? ""),
      },
    );
    this.policy.setIssuePromptAttempts(params.callSid, decision.nextState.askCount);

    if (
      decision.action.type === "ALREADY_CAPTURED" ||
      decision.action.type === "CAPTURE_ISSUE"
    ) {
      if (decision.action.type === "CAPTURE_ISSUE") {
        const sourceEventId = getRequestContext()?.sourceEventId ?? "";
        await this.policy.updateVoiceIssueCandidate({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          issue: {
            value: decision.action.value,
            sourceEventId,
            createdAt: new Date().toISOString(),
          },
        });
      }
      this.policy.clearIssuePromptAttempts(params.callSid);
      const includeFees = this.policy.shouldDiscloseFees({
        nameState: params.nameState,
        addressState: params.addressState,
        collectedData: params.collectedData,
        currentSpeech: params.transcript,
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
        reason: `${params.reason}_captured`,
        messageOverride: smsMessage,
      });
    }

    if (decision.action.type === "DEFER_TO_SMS") {
      await this.policy.log(
        {
          event: "voice.issue_capture_deferred_to_sms",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          attempt: decision.nextState.askCount,
          reason: params.reason,
        },
        this.policy.loggerContext,
      );
      return this.policy.replyWithSmsHandoff({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        reason: `${params.reason}_deferred_to_sms`,
        messageOverride: ISSUE_SLOT_SMS_DEFER_MESSAGE,
      });
    }

    const prompt = buildIssueSlotPrompt({ prefix: params.promptPrefix });
    return this.policy.replyWithTwiml(
      params.res,
      this.policy.buildSayGatherTwiml(
        this.policy.applyCsrStrategy(params.strategy, prompt),
      ),
    );
  }
}
