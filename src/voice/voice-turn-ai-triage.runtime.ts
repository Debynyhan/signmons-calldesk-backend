import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { CsrStrategy } from "./csr-strategy.selector";
import {
  capVoiceAiReply,
  isVoiceIssueCollectionPrompt,
  isVoiceIssueReconfirmationPrompt,
  shouldVoiceGatherMore,
} from "./intake/voice-issue-reply.policy";

type VoiceNameState = ReturnType<IConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  IConversationsService["getVoiceAddressState"]
>;
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

type AiTriageResult =
  | { status: "reply"; reply?: string; outcome?: string }
  | { status: "job_created"; message?: string }
  | { status: string; reply?: string; outcome?: string; message?: string };

type VoiceTurnAiTriagePolicy = {
  getVoiceIssueCandidate: (
    collectedData: Prisma.JsonValue | null,
  ) => { value?: string; sourceEventId?: string } | null;
  clearIssuePromptAttempts: (callSid: string) => void;
  normalizeIssueCandidate: (value: string) => string;
  isLikelyIssueCandidate: (value: string) => boolean;
  updateVoiceIssueCandidate: (params: {
    tenantId: string;
    conversationId: string;
    issue: {
      value: string;
      sourceEventId: string;
      createdAt: string;
    };
  }) => Promise<{ id: string; collectedData: Prisma.JsonValue } | null>;
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
  isIssueRepeatComplaint: (value: string) => boolean;
  triage: (params: {
    tenantId: string;
    callSid: string;
    triageInput: string;
    conversationId: string;
    timingCollector?: VoiceTurnTimingCollector;
  }) => Promise<AiTriageResult>;
  buildSmsHandoffMessage: (callerFirstName?: string) => string;
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
  normalizeConfirmationUtterance: (value: string) => string;
  replyWithTwiml: (res: Response | undefined, twiml: string) => Promise<string>;
  buildSayGatherTwiml: (message: string) => string;
  isHumanFallbackMessage: (message: string) => boolean;
  replyWithHumanFallback: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    reason: string;
    messageOverride?: string;
  }) => Promise<string>;
  isLikelyQuestion: (transcript: string) => boolean;
  isBookingIntent: (transcript: string) => boolean;
  replyWithBookingOffer: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    sourceEventId: string | null;
    message: string;
    strategy?: CsrStrategy;
  }) => Promise<string>;
  logVoiceOutcome: (params: {
    outcome: "sms_handoff" | "human_fallback" | "no_handoff";
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    reason: string;
  }) => void;
  buildTwiml: (message: string) => string;
  replyWithNoHandoff: (params: {
    res?: Response;
    tenantId: string;
    conversationId?: string;
    callSid?: string;
    reason: string;
  }) => Promise<string>;
  warn: (payload: Record<string, unknown>, context: string) => void;
  loggerContext: string;
};

export class VoiceTurnAiTriageRuntime {
  constructor(private readonly policy: VoiceTurnAiTriagePolicy) {}

  async handle(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    normalizedSpeech: string;
    currentEventId: string | null;
    nameReady: boolean;
    addressReady: boolean;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: Prisma.JsonValue | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
    shouldPromptForIssue: boolean;
  }): Promise<string> {
    const persistedIssueCandidate = this.policy.getVoiceIssueCandidate(
      params.collectedData,
    );
    let effectiveIssueCandidate = persistedIssueCandidate?.value ?? null;
    let capturedIssueFromCurrentTurn = false;
    if (effectiveIssueCandidate) {
      this.policy.clearIssuePromptAttempts(params.callSid);
    }

    if (
      !effectiveIssueCandidate &&
      params.nameReady &&
      params.addressReady
    ) {
      const issueFromTurn = this.policy.normalizeIssueCandidate(
        params.normalizedSpeech,
      );
      if (this.policy.isLikelyIssueCandidate(issueFromTurn)) {
        this.policy.clearIssuePromptAttempts(params.callSid);
        await this.policy.updateVoiceIssueCandidate({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          issue: {
            value: issueFromTurn,
            sourceEventId: params.currentEventId ?? "",
            createdAt: new Date().toISOString(),
          },
        });
        effectiveIssueCandidate = issueFromTurn;
        capturedIssueFromCurrentTurn = true;
      } else if (params.shouldPromptForIssue) {
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
          reason: "missing_issue_after_address",
          promptPrefix: this.policy.isIssueRepeatComplaint(params.normalizedSpeech)
            ? "I hear you, and I'm sorry for the repeat."
            : undefined,
          transcript: params.normalizedSpeech,
        });
      }
    }

    try {
      const triageInput =
        capturedIssueFromCurrentTurn && effectiveIssueCandidate
          ? effectiveIssueCandidate
          : params.normalizedSpeech;
      const aiResult = await this.policy.triage({
        tenantId: params.tenantId,
        callSid: params.callSid,
        triageInput,
        conversationId: params.conversationId,
        timingCollector: params.timingCollector,
      });

      if (aiResult.status === "reply" && "reply" in aiResult) {
        const safeReply = capVoiceAiReply(aiResult.reply ?? "");
        if (
          aiResult.outcome === "sms_handoff" ||
          safeReply === this.policy.buildSmsHandoffMessage()
        ) {
          const includeFees = this.policy.shouldDiscloseFees({
            nameState: params.nameState,
            addressState: params.addressState,
            collectedData: params.collectedData,
            currentSpeech: params.normalizedSpeech,
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
            reason: "ai_sms_handoff",
            messageOverride: smsMessage,
          });
        }

        const aiAsksForIssue =
          isVoiceIssueCollectionPrompt(safeReply, (value) =>
            this.policy.normalizeConfirmationUtterance(value),
          ) ||
          isVoiceIssueReconfirmationPrompt(safeReply, (value) =>
            this.policy.normalizeConfirmationUtterance(value),
          );

        if (
          params.nameReady &&
          params.addressReady &&
          effectiveIssueCandidate &&
          aiAsksForIssue
        ) {
          const includeFees = this.policy.shouldDiscloseFees({
            nameState: params.nameState,
            addressState: params.addressState,
            collectedData: params.collectedData,
            currentSpeech: effectiveIssueCandidate,
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
            reason: "ai_issue_reconfirm_guard",
            messageOverride: smsMessage,
          });
        }

        if (
          params.nameReady &&
          params.addressReady &&
          !effectiveIssueCandidate &&
          aiAsksForIssue
        ) {
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
            reason: "ai_issue_prompt_missing",
            transcript: params.normalizedSpeech,
          });
        }

        if (shouldVoiceGatherMore(safeReply)) {
          return this.policy.replyWithTwiml(
            params.res,
            this.policy.buildSayGatherTwiml(safeReply),
          );
        }
        if (this.policy.isHumanFallbackMessage(safeReply)) {
          return this.policy.replyWithHumanFallback({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            callSid: params.callSid,
            displayName: params.displayName,
            reason: "ai_fallback",
            messageOverride: safeReply,
          });
        }
        if (
          this.policy.isLikelyQuestion(params.normalizedSpeech) &&
          !this.policy.isBookingIntent(params.normalizedSpeech)
        ) {
          return this.policy.replyWithBookingOffer({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            callSid: params.callSid,
            sourceEventId: params.currentEventId,
            message: safeReply,
            strategy: params.strategy,
          });
        }
        this.policy.logVoiceOutcome({
          outcome: "no_handoff",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          reason: "ai_reply_end",
        });
        return this.policy.replyWithTwiml(
          params.res,
          this.policy.buildTwiml(safeReply),
        );
      }

      if (aiResult.status === "job_created" && "message" in aiResult) {
        const message = capVoiceAiReply(
          aiResult.message ?? "Your request has been booked.",
        );
        this.policy.logVoiceOutcome({
          outcome: "no_handoff",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          reason: "job_created_in_voice",
        });
        return this.policy.replyWithTwiml(
          params.res,
          this.policy.buildTwiml(message),
        );
      }

      return this.policy.replyWithNoHandoff({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        reason: "ai_unknown_status",
      });
    } catch {
      this.policy.warn(
        {
          event: "ai.preview_fallback",
          tenantId: params.tenantId,
          callSid: params.callSid,
          conversationId: params.conversationId,
          reason: "voice_triage_failed",
        },
        this.policy.loggerContext,
      );
      return this.policy.replyWithHumanFallback({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        reason: "ai_preview_fallback",
        messageOverride:
          "We're having trouble handling your call. Please try again later.",
      });
    }
  }
}
