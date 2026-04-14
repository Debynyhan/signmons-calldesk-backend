import { Injectable } from "@nestjs/common";
import {
  buildNameClarificationPrompt,
  extractNameCandidateDeterministic,
  isLikelyNameCandidate,
  isValidNameCandidate,
  normalizeNameCandidate,
  parseSpelledNameParts,
  shouldPromptForNameSpelling,
  shouldRepromptForLowConfidenceName,
} from "./intake/voice-name-candidate.policy";
import { VoiceTurnNameOpeningRuntime } from "./voice-turn-name-opening.runtime";
import { VoiceTurnNameCaptureRuntime } from "./voice-turn-name-capture.runtime";
import { VoiceTurnNameFlowRuntime } from "./voice-turn-name-flow.runtime";
import { VoiceTurnNameSpellingRuntime } from "./voice-turn-name-spelling.runtime";
import { VoiceTurnDependencies } from "./voice-turn.dependencies";
import { CsrStrategy } from "./csr-strategy.selector";
import type {
  VoiceTurnRuntimeSet,
  VoiceTurnTimingCollector,
} from "./voice-turn-runtime.types";
import { LOGGER_CONTEXT } from "./voice-turn-runtime.types";

@Injectable()
export class VoiceTurnNameFlowFactory {
  private runtimes!: VoiceTurnRuntimeSet;

  constructor(private readonly deps: VoiceTurnDependencies) {}

  configure(runtimes: VoiceTurnRuntimeSet): void {
    this.runtimes = runtimes;

    runtimes.turnNameOpeningRuntime = new VoiceTurnNameOpeningRuntime({
      isOpeningGreetingOnly: (transcript) =>
        this.deps.voiceTurnPolicyService.isOpeningGreetingOnly(transcript),
      extractNameCandidateDeterministic: (transcript) =>
        extractNameCandidateDeterministic(
          transcript,
          this.deps.sanitizationService,
        ),
      normalizeIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.normalizeIssueCandidate(value),
      isLikelyIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.isLikelyIssueCandidate(value),
      clearIssuePromptAttempts: (callSid) =>
        this.deps.voiceResponseService.clearIssuePromptAttempts(callSid),
      updateVoiceIssueCandidate: (params) =>
        this.deps.voiceTurnOrchestration.updateVoiceIssueCandidate(params),
      buildIssueAcknowledgement: (value) =>
        this.deps.voiceTurnPolicyService.buildIssueAcknowledgement(value),
      buildSideQuestionReply: (tenantId, transcript) =>
        this.runtimes.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
      replyWithBookingOffer: (params) => this.replyWithBookingOffer(params),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
    });

    runtimes.turnNameCaptureRuntime = new VoiceTurnNameCaptureRuntime({
      normalizeIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.normalizeIssueCandidate(value),
      isLikelyIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.isLikelyIssueCandidate(value),
      getVoiceIssueCandidate: (collectedData) =>
        this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData),
      updateVoiceIssueCandidate: (params) =>
        this.deps.voiceTurnOrchestration.updateVoiceIssueCandidate(params),
      buildIssueAcknowledgement: (value) =>
        this.deps.voiceTurnPolicyService.buildIssueAcknowledgement(value),
      buildSideQuestionReply: (tenantId, transcript) =>
        this.runtimes.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
      replyWithBookingOffer: (params) => this.replyWithBookingOffer(params),
      isLikelyAddressInputForName: (transcript) =>
        this.deps.voiceTurnPolicyService.isLikelyAddressInputForName(
          transcript,
        ),
      extractNameCandidateDeterministic: (transcript) =>
        extractNameCandidateDeterministic(
          transcript,
          this.deps.sanitizationService,
        ),
      extractNameCandidate: (tenantId, transcript, timingCollector) =>
        this.trackAiCall(timingCollector, () =>
          this.deps.aiService.extractNameCandidate(tenantId, transcript),
        ),
      normalizeNameCandidate: (value) =>
        normalizeNameCandidate(value, this.deps.sanitizationService),
      isValidNameCandidate: (value) => isValidNameCandidate(value),
      isLikelyNameCandidate: (value) => isLikelyNameCandidate(value),
      shouldPromptForNameSpelling: (state, candidate) =>
        shouldPromptForNameSpelling(
          state,
          candidate,
          this.deps.sanitizationService,
        ),
      buildAskNameTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildAskNameTwiml(strategy),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
    });

    runtimes.turnNameFlowRuntime = new VoiceTurnNameFlowRuntime({
      updateVoiceNameState: (params) =>
        this.deps.voiceNameSlot.updateVoiceNameState(params),
      shouldRepromptForLowConfidenceName: (state, candidate) =>
        shouldRepromptForLowConfidenceName(
          state,
          candidate,
          this.deps.sanitizationService,
        ),
      buildNameClarificationPrompt: (candidate) =>
        buildNameClarificationPrompt(candidate, this.deps.sanitizationService),
      shouldPromptForNameSpelling: (state, candidate) =>
        shouldPromptForNameSpelling(
          state,
          candidate,
          this.deps.sanitizationService,
        ),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
      buildSayGatherTwiml: (message, options) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message, options),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      log: (payload) => this.deps.loggingService.log(payload, LOGGER_CONTEXT),
    });

    runtimes.turnNameSpellingRuntime = new VoiceTurnNameSpellingRuntime({
      parseSpelledNameParts: (transcript) => parseSpelledNameParts(transcript),
      extractNameCandidateDeterministic: (transcript) =>
        extractNameCandidateDeterministic(
          transcript,
          this.deps.sanitizationService,
        ),
      normalizeNameCandidate: (value) =>
        normalizeNameCandidate(value, this.deps.sanitizationService),
      isValidNameCandidate: (value) => isValidNameCandidate(value),
      isLikelyNameCandidate: (value) => isLikelyNameCandidate(value),
      updateVoiceNameState: (params) =>
        this.deps.voiceNameSlot.updateVoiceNameState(params),
      log: (payload) => this.deps.loggingService.log(payload, LOGGER_CONTEXT),
    });
  }

  private applyCsrStrategy(
    strategy: CsrStrategy | undefined,
    message: string,
  ): string {
    return this.deps.voicePromptComposer.applyCsrStrategy(strategy, message);
  }

  private async replyWithBookingOffer(params: {
    res?: import("express").Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    sourceEventId: string | null;
    message: string;
    strategy?: CsrStrategy;
  }): Promise<string> {
    return this.runtimes.turnHandoffRuntime.replyWithBookingOffer(params);
  }

  private async trackAiCall<T>(
    timingCollector: VoiceTurnTimingCollector | undefined,
    callback: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      return await callback();
    } finally {
      if (timingCollector) {
        timingCollector.aiMs += Date.now() - startedAt;
        timingCollector.aiCalls = (timingCollector.aiCalls ?? 0) + 1;
      }
    }
  }
}
