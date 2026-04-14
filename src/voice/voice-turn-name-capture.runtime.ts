import type { Response } from "express";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { CsrStrategy } from "./csr-strategy.selector";
import { buildNameFollowUpPrompt } from "./intake/voice-name-slot.reducer";

type VoiceNameState = ReturnType<IConversationsService["getVoiceNameState"]>;
type StoreProvisionalNameOptions = {
  lastConfidence?: number | null;
  corrections?: number;
  firstNameSpelled?: string | null;
  spellPromptedAt?: number | null;
  spellPromptedTurnIndex?: number | null;
  spellPromptCount?: number;
};
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

type VoiceTurnNameCapturePolicy = {
  normalizeIssueCandidate: (value: string) => string;
  isLikelyIssueCandidate: (value: string) => boolean;
  getVoiceIssueCandidate: (
    collectedData: unknown,
  ) => { value?: string; sourceEventId?: string } | null;
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
  isLikelyAddressInputForName: (transcript: string) => boolean;
  extractNameCandidateDeterministic: (transcript: string) => string | null;
  extractNameCandidate: (
    tenantId: string,
    transcript: string,
    timingCollector?: VoiceTurnTimingCollector,
  ) => Promise<string | null>;
  normalizeNameCandidate: (value: string) => string;
  isValidNameCandidate: (value: string) => boolean;
  isLikelyNameCandidate: (value: string) => boolean;
  shouldPromptForNameSpelling: (
    state: VoiceNameState,
    candidate: string,
  ) => boolean;
  buildAskNameTwiml: (strategy?: CsrStrategy) => string;
  buildSayGatherTwiml: (message: string) => string;
  applyCsrStrategy: (strategy: CsrStrategy | undefined, message: string) => string;
};

export class VoiceTurnNameCaptureRuntime {
  constructor(private readonly policy: VoiceTurnNameCapturePolicy) {}

  async handle(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    currentEventId: string | null;
    normalizedSpeech: string;
    expectedField: string | null;
    bookingIntent: boolean;
    nameState: VoiceNameState;
    collectedData: unknown;
    confidence?: number;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
    recordNameAttemptIfNeeded: () => Promise<void>;
    replyWithAddressPrompt: (preface?: string) => Promise<string>;
    replyWithNameTwiml: (twiml: string) => Promise<string>;
    storeProvisionalName: (
      candidate: string,
      options?: StoreProvisionalNameOptions,
    ) => Promise<VoiceNameState>;
    promptForNameSpelling: (
      candidate: string,
      baseNameState: VoiceNameState,
    ) => Promise<string>;
    maybePromptForSpelling: (
      candidate: string,
      nextNameState: VoiceNameState,
      issueSummary?: string | null,
    ) => Promise<string>;
    acknowledgeNameAndMoveOn: (
      candidate: string,
      issueSummary?: string | null,
    ) => Promise<string>;
  }): Promise<string> {
    const issueCandidate = this.policy.normalizeIssueCandidate(
      params.normalizedSpeech,
    );
    if (this.policy.isLikelyIssueCandidate(issueCandidate)) {
      const existingIssue = this.policy.getVoiceIssueCandidate(params.collectedData);
      if (!existingIssue?.value) {
        await this.policy.updateVoiceIssueCandidate({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          issue: {
            value: issueCandidate,
            sourceEventId: params.currentEventId ?? "",
            createdAt: new Date().toISOString(),
          },
        });
      }
      const followUp = buildNameFollowUpPrompt(
        this.policy.buildIssueAcknowledgement(params.normalizedSpeech),
      );
      if (params.nameState.attemptCount >= 1) {
        await params.recordNameAttemptIfNeeded();
        return params.replyWithAddressPrompt();
      }
      return params.replyWithNameTwiml(
        this.policy.buildSayGatherTwiml(
          this.policy.applyCsrStrategy(params.strategy, followUp),
        ),
      );
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

    const duplicateMissing =
      !params.nameState.candidate.value &&
      params.nameState.candidate.sourceEventId === params.currentEventId;
    if (duplicateMissing) {
      if (params.nameState.attemptCount >= 1) {
        await params.recordNameAttemptIfNeeded();
        return params.replyWithAddressPrompt();
      }
      return params.replyWithNameTwiml(
        this.policy.buildAskNameTwiml(params.strategy),
      );
    }

    if (this.policy.isLikelyAddressInputForName(params.normalizedSpeech)) {
      await params.recordNameAttemptIfNeeded();
      return params.replyWithAddressPrompt();
    }

    const deterministicCandidate = this.policy.extractNameCandidateDeterministic(
      params.normalizedSpeech,
    );
    const extracted =
      deterministicCandidate ??
      (await this.policy.extractNameCandidate(
        params.tenantId,
        params.normalizedSpeech,
        params.timingCollector,
      ));
    const candidateName = this.policy.normalizeNameCandidate(extracted ?? "");
    const validatedCandidate =
      this.policy.isValidNameCandidate(candidateName) &&
      this.policy.isLikelyNameCandidate(candidateName)
        ? candidateName
        : "";
    if (validatedCandidate) {
      const existingCandidate = params.nameState.candidate.value;
      if (
        existingCandidate &&
        existingCandidate.trim().toLowerCase() ===
          validatedCandidate.trim().toLowerCase()
      ) {
        if (
          this.policy.shouldPromptForNameSpelling(
            params.nameState,
            existingCandidate,
          )
        ) {
          return params.promptForNameSpelling(existingCandidate, params.nameState);
        }
        return params.acknowledgeNameAndMoveOn(existingCandidate);
      }
      const isCorrection =
        Boolean(existingCandidate) && validatedCandidate !== existingCandidate;
      const nextCorrections = isCorrection
        ? (params.nameState.corrections ?? 0) + 1
        : (params.nameState.corrections ?? 0);
      const nextNameState = await params.storeProvisionalName(validatedCandidate, {
        lastConfidence: params.confidence ?? null,
        corrections: nextCorrections,
      });
      return params.maybePromptForSpelling(validatedCandidate, nextNameState);
    }

    if (params.nameState.candidate.value) {
      if (
        this.policy.shouldPromptForNameSpelling(
          params.nameState,
          params.nameState.candidate.value,
        )
      ) {
        return params.promptForNameSpelling(
          params.nameState.candidate.value,
          params.nameState,
        );
      }
      return params.acknowledgeNameAndMoveOn(params.nameState.candidate.value);
    }

    if (!params.expectedField) {
      const extraSideReply = await this.policy.buildSideQuestionReply(
        params.tenantId,
        params.normalizedSpeech,
      );
      if (extraSideReply && !params.bookingIntent) {
        return this.policy.replyWithBookingOffer({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          sourceEventId: params.currentEventId,
          message: extraSideReply,
          strategy: params.strategy,
        });
      }
    }

    if (params.nameState.attemptCount >= 1) {
      await params.recordNameAttemptIfNeeded();
      return params.replyWithAddressPrompt();
    }

    return params.replyWithNameTwiml(
      this.policy.buildAskNameTwiml(params.strategy),
    );
  }
}
