import type { Response } from "express";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { CsrStrategy } from "./csr-strategy.selector";
import { buildNameFollowUpPrompt } from "./intake/voice-name-slot.reducer";
import {
  isLikelyNameCandidate,
  isValidNameCandidate,
} from "./intake/voice-name-candidate.policy";

type VoiceNameState = ReturnType<IConversationsService["getVoiceNameState"]>;
type StoreProvisionalNameOptions = {
  lastConfidence?: number | null;
  corrections?: number;
  firstNameSpelled?: string | null;
  spellPromptedAt?: number | null;
  spellPromptedTurnIndex?: number | null;
  spellPromptCount?: number;
};

type VoiceTurnNameOpeningPolicy = {
  isOpeningGreetingOnly: (transcript: string) => boolean;
  extractNameCandidateDeterministic: (transcript: string) => string | null;
  normalizeIssueCandidate: (value: string) => string;
  isLikelyIssueCandidate: (value: string) => boolean;
  clearIssuePromptAttempts: (callSid: string) => void;
  updateVoiceIssueCandidate: (params: {
    tenantId: string;
    conversationId: string;
    issue: {
      value: string;
      sourceEventId: string;
      createdAt: string;
    };
  }) => Promise<{ id: string; collectedData: unknown } | null>;
  buildIssueAcknowledgement: (value: string) => string | null;
  buildSideQuestionReply: (
    tenantId: string,
    transcript: string,
  ) => Promise<string | null>;
  replyWithBookingOffer: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    sourceEventId: string | null;
    message: string;
    strategy?: CsrStrategy;
  }) => Promise<string>;
  buildSayGatherTwiml: (message: string) => string;
  applyCsrStrategy: (strategy: CsrStrategy | undefined, message: string) => string;
};

export class VoiceTurnNameOpeningRuntime {
  constructor(private readonly policy: VoiceTurnNameOpeningPolicy) {}

  async handle(params: {
    isOpeningTurn: boolean;
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    currentEventId: string | null;
    normalizedSpeech: string;
    bookingIntent: boolean;
    nameState: VoiceNameState;
    confidence?: number;
    strategy?: CsrStrategy;
    storeProvisionalName: (
      candidate: string,
      options?: StoreProvisionalNameOptions,
    ) => Promise<VoiceNameState>;
    maybePromptForSpelling: (
      candidate: string,
      nextNameState: VoiceNameState,
      issueSummary?: string | null,
    ) => Promise<string>;
    replyWithNameTwiml: (twiml: string) => Promise<string>;
  }): Promise<string | null> {
    if (!params.isOpeningTurn) {
      return null;
    }

    if (this.policy.isOpeningGreetingOnly(params.normalizedSpeech)) {
      return params.replyWithNameTwiml(
        this.policy.buildSayGatherTwiml(
          this.policy.applyCsrStrategy(
            params.strategy,
            "I'm here to help. Please say your full name and briefly what's going on with the system.",
          ),
        ),
      );
    }

    const openingCandidate = this.policy.extractNameCandidateDeterministic(
      params.normalizedSpeech,
    );
    const hasOpeningName =
      openingCandidate &&
      isValidNameCandidate(openingCandidate) &&
      isLikelyNameCandidate(openingCandidate);
    const issueCandidate = this.policy.normalizeIssueCandidate(
      params.normalizedSpeech,
    );
    const hasIssue = this.policy.isLikelyIssueCandidate(issueCandidate);

    if (hasIssue) {
      this.policy.clearIssuePromptAttempts(params.callSid);
      await this.policy.updateVoiceIssueCandidate({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        issue: {
          value: issueCandidate,
          sourceEventId: params.currentEventId ?? "",
          createdAt: new Date().toISOString(),
        },
      });
      if (hasOpeningName && openingCandidate) {
        const issueSummary = this.policy.buildIssueAcknowledgement(
          params.normalizedSpeech,
        );
        const nextNameState = await params.storeProvisionalName(
          openingCandidate,
          {
            lastConfidence: params.confidence ?? null,
            corrections: params.nameState.corrections ?? 0,
          },
        );
        return params.maybePromptForSpelling(
          openingCandidate,
          nextNameState,
          issueSummary,
        );
      }
      const followUp = buildNameFollowUpPrompt(
        this.policy.buildIssueAcknowledgement(params.normalizedSpeech),
      );
      return params.replyWithNameTwiml(
        this.policy.buildSayGatherTwiml(
          this.policy.applyCsrStrategy(params.strategy, followUp),
        ),
      );
    }

    if (hasOpeningName && openingCandidate) {
      const nextNameState = await params.storeProvisionalName(openingCandidate, {
        lastConfidence: params.confidence ?? null,
        corrections: params.nameState.corrections ?? 0,
      });
      return params.maybePromptForSpelling(openingCandidate, nextNameState);
    }

    const sideQuestionReply = await this.policy.buildSideQuestionReply(
      params.tenantId,
      params.normalizedSpeech,
    );
    if (sideQuestionReply && !params.bookingIntent) {
      return this.policy.replyWithBookingOffer({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        sourceEventId: params.currentEventId,
        message: sideQuestionReply,
        strategy: params.strategy,
      });
    }
    const followUp = sideQuestionReply
      ? `${sideQuestionReply} What's your full name?`
      : "What's your full name?";
    return params.replyWithNameTwiml(
      this.policy.buildSayGatherTwiml(
        this.policy.applyCsrStrategy(params.strategy, followUp),
      ),
    );
  }
}
