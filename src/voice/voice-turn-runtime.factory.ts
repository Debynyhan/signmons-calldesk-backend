import { Inject, Injectable } from "@nestjs/common";
import type { Response } from "express";
import {
  CommunicationChannel,
  Prisma,
} from "@prisma/client";
import type { TenantFeePolicy as PrismaTenantFeePolicy } from "@prisma/client";
import appConfig, { type AppConfig } from "../config/app.config";
import { ConversationsService } from "../conversations/conversations.service";
import { CsrStrategy } from "./csr-strategy.selector";
import {
  buildNameClarificationPrompt,
  extractNameCandidateDeterministic,
  isLikelyNameCandidate,
  isValidNameCandidate,
  normalizeNameCandidate,
  parseSpelledNameParts,
  shouldRepromptForLowConfidenceName,
  shouldPromptForNameSpelling,
} from "./intake/voice-name-candidate.policy";
import {
  normalizeConfirmationUtterance,
  resolveConfirmation,
  stripConfirmationPrefix,
  type VoiceConfirmationResolution,
} from "./intake/voice-field-confirmation.policy";
import {
  extractVoiceSmsPhoneCandidate,
  getVoiceCallerPhoneFromCollectedData,
  isVoiceSmsNumberConfirmation,
} from "./intake/voice-sms-phone-confirmation.policy";
import { shouldIgnoreVoiceStreamingTranscript } from "./intake/voice-streaming-transcript.policy";
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
import { VoiceTurnDependencies } from "./voice-turn.dependencies";

// Logger context string kept consistent with VoiceTurnService so logs remain
// attributable to the turn service without coupling the factory to it.
const LOGGER_CONTEXT = "VoiceTurnService";

type VoiceListeningField =
  | "name"
  | "address"
  | "confirmation"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";
type VoiceExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";
type VoiceListeningWindow = {
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
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

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

@Injectable()
export class VoiceTurnRuntimeFactory {
  // Populated at the start of build() so coordination methods can reference
  // runtimes via this.runtimes.turnXxx. Safe because lambdas that invoke
  // coordination methods are only called at turn-process time — well after
  // build() has completed and all runtimes are fully wired.
  private runtimes!: VoiceTurnRuntimeSet;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly deps: VoiceTurnDependencies,
  ) {}

  build(): VoiceTurnRuntimeSet {
    const r = {} as VoiceTurnRuntimeSet;
    this.runtimes = r;

    r.turnPreludeRuntime = new VoiceTurnPreludeRuntime(
      this.config,
      this.deps.conversationsService,
      this.deps.voiceConversationStateService,
      this.deps.callLogService,
      {
        getVoiceListeningWindow: (collectedData) =>
          this.deps.voiceListeningWindowService.getVoiceListeningWindow(collectedData),
        getExpectedListeningField: (listeningWindow) =>
          this.deps.voiceListeningWindowService.getExpectedListeningField(
            listeningWindow as VoiceListeningWindow | null,
          ),
        shouldIgnoreStreamingTranscript: (
          transcript,
          collectedData,
          expectedField,
        ) =>
          shouldIgnoreVoiceStreamingTranscript({
            transcript,
            expectedField: expectedField as VoiceExpectedField | null,
            isConfirmationWindow:
              this.deps.voiceListeningWindowService.getVoiceListeningWindow(collectedData)?.field ===
              "confirmation",
            isSlowDownRequest: (value) =>
              this.deps.voiceUtteranceService.isSlowDownRequest(value),
            isFrustrationRequest: (value) =>
              this.deps.voiceUtteranceService.isFrustrationRequest(value),
            isHumanTransferRequest: (value) =>
              this.deps.voiceUtteranceService.isHumanTransferRequest(value),
            isSmsDifferentNumberRequest: (value) =>
              this.deps.voiceUtteranceService.isSmsDifferentNumberRequest(value),
            isHangupRequest: (value) =>
              this.deps.voiceUtteranceService.isHangupRequest(value),
            resolveBinaryUtterance: (value) =>
              this.deps.voiceUtteranceService.resolveBinaryUtterance(value),
            normalizeNameCandidate: (value) =>
              normalizeNameCandidate(value, this.deps.sanitizationService),
            isValidNameCandidate: (value) => isValidNameCandidate(value),
            isLikelyNameCandidate: (value) => isLikelyNameCandidate(value),
            normalizeIssueCandidate: (value) =>
              this.deps.voiceTurnPolicyService.normalizeIssueCandidate(value),
            isLikelyIssueCandidate: (value) =>
              this.deps.voiceTurnPolicyService.isLikelyIssueCandidate(value),
            normalizeConfirmationUtterance: (value) =>
              normalizeConfirmationUtterance(value),
            isSmsNumberConfirmation: (value) =>
              isVoiceSmsNumberConfirmation(value),
          }),
        isDuplicateTranscript: (collectedData, transcript, now) =>
          this.deps.voiceUtteranceService.isDuplicateTranscript(
            collectedData,
            transcript,
            now,
          ),
        normalizeConfidence: (value) =>
          this.deps.voiceTurnPolicyService.normalizeConfidence(value),
        getTenantDisplayName: (tenant) =>
          this.deps.voiceTurnPolicyService.getTenantDisplayName(tenant),
        buildRepromptTwiml: () => this.deps.voicePromptComposer.buildRepromptTwiml(),
        buildSayGatherTwiml: (message) =>
          this.deps.voicePromptComposer.buildSayGatherTwiml(message),
        replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
        replyWithNoHandoff: (params) => this.deps.voiceResponseService.replyWithNoHandoff(params),
        replyWithHumanFallback: (params) => this.deps.voiceResponseService.replyWithHumanFallback(params),
      },
    );
    r.turnContextRuntime = new VoiceTurnContextRuntime(this.deps.loggingService, {
      getVoiceNameState: (collectedData) =>
        this.deps.conversationsService.getVoiceNameState(collectedData),
      getVoiceSmsPhoneState: (collectedData) =>
        this.deps.conversationsService.getVoiceSmsPhoneState(collectedData),
      getVoiceAddressState: (collectedData) =>
        this.deps.conversationsService.getVoiceAddressState(collectedData),
      selectCsrStrategy: (params) => this.selectCsrStrategy(params),
      normalizeCsrStrategyForTurn: (strategy, turnCount) =>
        this.normalizeCsrStrategyForTurn(strategy, turnCount),
      getVoiceListeningWindow: (collectedData) =>
        this.deps.voiceListeningWindowService.getVoiceListeningWindow(collectedData),
      shouldClearListeningWindow: (
        listeningWindow,
        now,
        nameState,
        addressState,
        phoneState,
      ) =>
        this.deps.voiceListeningWindowService.shouldClearListeningWindow(
          listeningWindow,
          now,
          nameState,
          addressState,
          phoneState,
        ),
      clearVoiceListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.clearVoiceListeningWindow(params),
      getVoiceLastEventId: (collectedData) =>
        this.deps.voiceListeningWindowService.getVoiceLastEventId(collectedData),
      replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      buildListeningWindowReprompt: (params) =>
        this.deps.voiceListeningWindowService.buildListeningWindowReprompt(params),
      markVoiceEventProcessed: (params) => this.markVoiceEventProcessed(params),
      getExpectedListeningField: (window) =>
        this.deps.voiceListeningWindowService.getExpectedListeningField(window),
      isVoiceFieldReady: (locked, confirmed) =>
        this.deps.voiceTurnPolicyService.isVoiceFieldReady(locked, confirmed),
    });
    r.turnEarlyRoutingRuntime = new VoiceTurnEarlyRoutingRuntime({
      resolveBinaryUtterance: (transcript) =>
        this.deps.voiceUtteranceService.resolveBinaryUtterance(transcript),
      isBookingIntent: (transcript) =>
        this.deps.voiceUtteranceService.isBookingIntent(transcript),
      clearVoiceListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.clearVoiceListeningWindow(params),
      replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildBookingPromptTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildBookingPromptTwiml(strategy),
      replyWithHumanFallback: (params) => this.deps.voiceResponseService.replyWithHumanFallback(params),
      buildCallbackOfferTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildCallbackOfferTwiml(strategy),
      handleExpectedUrgencyField: (params) =>
        this.deps.voiceUrgencySlotService.handleExpectedField(params),
      continueAfterSideQuestionWithIssueRouting: (params) =>
        this.continueAfterSideQuestionWithIssueRouting(params),
      buildUrgencyConfirmTwiml: (strategy, opts) =>
        this.buildUrgencyConfirmTwiml(strategy, opts),
    });
    r.turnExpectedFieldRuntime = new VoiceTurnExpectedFieldRuntime({
      getVoiceSmsHandoff: (collectedData) =>
        this.deps.conversationsService.getVoiceSmsHandoff(collectedData),
      getCallerPhoneFromCollectedData: (collectedData) =>
        getVoiceCallerPhoneFromCollectedData(collectedData),
      normalizeConfirmationUtterance: (value) =>
        normalizeConfirmationUtterance(value),
      isSmsNumberConfirmation: (transcript) =>
        isVoiceSmsNumberConfirmation(transcript),
      extractSmsPhoneCandidate: (transcript) =>
        extractVoiceSmsPhoneCandidate(transcript, (value) =>
          this.deps.sanitizationService.normalizePhoneE164(value),
        ),
      handleExpectedSmsPhoneField: (params) =>
        this.deps.voiceSmsPhoneSlotService.handleExpectedField(params),
      replyWithSmsHandoff: (params) =>
        r.turnHandoffRuntime.replyWithSmsHandoff(params),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildAskSmsNumberTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildAskSmsNumberTwiml(strategy),
      replyWithHumanFallback: (params) => this.deps.voiceResponseService.replyWithHumanFallback(params),
      loggerContext: LOGGER_CONTEXT,
    });
    r.turnInterruptRuntime = new VoiceTurnInterruptRuntime(
      {
        isSlowDownRequest: (transcript) =>
          this.deps.voiceUtteranceService.isSlowDownRequest(transcript),
        replyWithListeningWindow: (params) =>
          this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
        buildTakeYourTimeTwiml: (field, strategy) =>
          this.deps.voicePromptComposer.buildTakeYourTimeTwiml(field, strategy),
        replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
        buildSayGatherTwiml: (message) =>
          this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      },
      {
        isHangupRequest: (transcript) =>
          this.deps.voiceUtteranceService.isHangupRequest(transcript),
        clearIssuePromptAttempts: (callSid) =>
          this.deps.voiceResponseService.clearIssuePromptAttempts(callSid),
        replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
        buildTwiml: (message) => this.deps.voicePromptComposer.buildTwiml(message),
        isHumanTransferRequest: (transcript) =>
          this.deps.voiceUtteranceService.isHumanTransferRequest(transcript),
        replyWithListeningWindow: (params) =>
          this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
        buildCallbackOfferTwiml: (strategy) =>
          this.deps.voicePromptComposer.buildCallbackOfferTwiml(strategy),
        isSmsDifferentNumberRequest: (transcript) =>
          this.deps.voiceUtteranceService.isSmsDifferentNumberRequest(transcript),
        updateVoiceSmsHandoff: (params) =>
          this.deps.voiceConversationStateService.updateVoiceSmsHandoff(params),
        updateVoiceSmsPhoneState: (params) =>
          this.deps.voiceConversationStateService.updateVoiceSmsPhoneState(params),
        buildAskSmsNumberTwiml: (strategy) =>
          this.deps.voicePromptComposer.buildAskSmsNumberTwiml(strategy),
      },
    );
    r.turnSideQuestionHelperRuntime = new VoiceTurnSideQuestionHelperRuntime(
      {
        normalizeWhitespace: (value) =>
          this.deps.sanitizationService.normalizeWhitespace(value),
        stripConfirmationPrefix: (value) =>
          stripConfirmationPrefix(value, this.deps.sanitizationService),
        isLikelyQuestion: (value) =>
          this.deps.voiceUtteranceService.isLikelyQuestion(value),
        getTenantFeePolicySafe: (tenantId) =>
          this.deps.voiceHandoffPolicy.getTenantFeePolicySafe(tenantId),
        getTenantFeeConfig: (policy) =>
          this.deps.voiceHandoffPolicy.getTenantFeeConfig(
            policy as PrismaTenantFeePolicy | null,
          ),
        formatFeeAmount: (value) => this.deps.voiceHandoffPolicy.formatFeeAmount(value),
        getTenantDisplayNameById: async (tenantId) => {
          try {
            const tenant = await this.deps.tenantsService.getTenantContext(tenantId);
            return tenant.displayName;
          } catch {
            return null;
          }
        },
        buildAskNameTwiml: (strategy) =>
          this.deps.voicePromptComposer.buildAskNameTwiml(strategy),
        prependPrefaceToGatherTwiml: (preface, twiml) =>
          this.deps.voicePromptComposer.prependPrefaceToGatherTwiml(preface, twiml),
        replyWithListeningWindow: (params) =>
          this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
        buildAddressPromptForState: (addressState, strategy) =>
          this.buildAddressPromptForState(addressState, strategy),
        buildAskSmsNumberTwiml: (strategy) =>
          this.deps.voicePromptComposer.buildAskSmsNumberTwiml(strategy),
        buildBookingPromptTwiml: (strategy) =>
          this.deps.voicePromptComposer.buildBookingPromptTwiml(strategy),
        buildCallbackOfferTwiml: (strategy) =>
          this.deps.voicePromptComposer.buildCallbackOfferTwiml(strategy),
      },
    );
    r.turnNameOpeningRuntime = new VoiceTurnNameOpeningRuntime({
      isOpeningGreetingOnly: (transcript) =>
        this.deps.voiceTurnPolicyService.isOpeningGreetingOnly(transcript),
      extractNameCandidateDeterministic: (transcript) =>
        extractNameCandidateDeterministic(transcript, this.deps.sanitizationService),
      normalizeIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.normalizeIssueCandidate(value),
      isLikelyIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.isLikelyIssueCandidate(value),
      clearIssuePromptAttempts: (callSid) =>
        this.deps.voiceResponseService.clearIssuePromptAttempts(callSid),
      updateVoiceIssueCandidate: (params) =>
        this.deps.voiceConversationStateService.updateVoiceIssueCandidate(params),
      buildIssueAcknowledgement: (value) =>
        this.deps.voiceTurnPolicyService.buildIssueAcknowledgement(value),
      buildSideQuestionReply: (tenantId, transcript) =>
        r.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
      replyWithBookingOffer: (params) => this.replyWithBookingOffer(params),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
    });
    r.turnNameCaptureRuntime = new VoiceTurnNameCaptureRuntime({
      normalizeIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.normalizeIssueCandidate(value),
      isLikelyIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.isLikelyIssueCandidate(value),
      getVoiceIssueCandidate: (collectedData) =>
        this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData),
      updateVoiceIssueCandidate: (params) =>
        this.deps.voiceConversationStateService.updateVoiceIssueCandidate(params),
      buildIssueAcknowledgement: (value) =>
        this.deps.voiceTurnPolicyService.buildIssueAcknowledgement(value),
      buildSideQuestionReply: (tenantId, transcript) =>
        r.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
      replyWithBookingOffer: (params) => this.replyWithBookingOffer(params),
      isLikelyAddressInputForName: (transcript) =>
        this.deps.voiceTurnPolicyService.isLikelyAddressInputForName(transcript),
      extractNameCandidateDeterministic: (transcript) =>
        extractNameCandidateDeterministic(transcript, this.deps.sanitizationService),
      extractNameCandidate: (tenantId, transcript, timingCollector) =>
        this.trackAiCall(timingCollector, () =>
          this.deps.aiService.extractNameCandidate(tenantId, transcript),
        ),
      normalizeNameCandidate: (value) =>
        normalizeNameCandidate(value, this.deps.sanitizationService),
      isValidNameCandidate: (value) => isValidNameCandidate(value),
      isLikelyNameCandidate: (value) => isLikelyNameCandidate(value),
      shouldPromptForNameSpelling: (state, candidate) =>
        shouldPromptForNameSpelling(state, candidate, this.deps.sanitizationService),
      buildAskNameTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildAskNameTwiml(strategy),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
    });
    r.turnNameFlowRuntime = new VoiceTurnNameFlowRuntime({
      updateVoiceNameState: (params) =>
        this.deps.voiceConversationStateService.updateVoiceNameState(params),
      shouldRepromptForLowConfidenceName: (state, candidate) =>
        shouldRepromptForLowConfidenceName(
          state,
          candidate,
          this.deps.sanitizationService,
        ),
      buildNameClarificationPrompt: (candidate) =>
        buildNameClarificationPrompt(candidate, this.deps.sanitizationService),
      shouldPromptForNameSpelling: (state, candidate) =>
        shouldPromptForNameSpelling(state, candidate, this.deps.sanitizationService),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
      buildSayGatherTwiml: (message, options) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message, options),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      log: (payload) => this.deps.loggingService.log(payload, LOGGER_CONTEXT),
    });
    r.turnNameSpellingRuntime = new VoiceTurnNameSpellingRuntime({
      parseSpelledNameParts: (transcript) => parseSpelledNameParts(transcript),
      extractNameCandidateDeterministic: (transcript) =>
        extractNameCandidateDeterministic(transcript, this.deps.sanitizationService),
      normalizeNameCandidate: (value) =>
        normalizeNameCandidate(value, this.deps.sanitizationService),
      isValidNameCandidate: (value) => isValidNameCandidate(value),
      isLikelyNameCandidate: (value) => isLikelyNameCandidate(value),
      updateVoiceNameState: (params) =>
        this.deps.voiceConversationStateService.updateVoiceNameState(params),
      log: (payload) => this.deps.loggingService.log(payload, LOGGER_CONTEXT),
    });
    r.turnAddressExtractionRuntime = new VoiceTurnAddressExtractionRuntime({
      sanitizer: this.deps.sanitizationService,
      voiceAddressMinConfidence: this.config.voiceAddressMinConfidence ?? 0.7,
      extractAddressCandidate: (tenantId, transcript, timingCollector) =>
        this.trackAiCall(timingCollector, () =>
          this.deps.aiService.extractAddressCandidate(tenantId, transcript),
        ),
      updateVoiceAddressState: (params) =>
        this.deps.voiceConversationStateService.updateVoiceAddressState(params),
      deferAddressToSmsAuthority: (params) =>
        this.deferAddressToSmsAuthority(params),
      replyWithAddressPromptWindow: (params) =>
        this.replyWithAddressPromptWindow(params),
      handleMissingLocalityPrompt: (params) =>
        this.handleMissingLocalityPrompt(params),
      replyWithAddressConfirmationWindow: (params) =>
        this.replyWithAddressConfirmationWindow(params),
    });
    r.turnAddressCompletenessRuntime =
      new VoiceTurnAddressCompletenessRuntime({
        handleMissingLocalityPrompt: (params) =>
          this.handleMissingLocalityPrompt(params),
        replyWithAddressPromptWindow: (params) =>
          this.replyWithAddressPromptWindow(params),
      });
    r.turnAddressConfirmedRuntime = new VoiceTurnAddressConfirmedRuntime({
      updateVoiceAddressState: (params) =>
        this.deps.voiceConversationStateService.updateVoiceAddressState(params),
      clearVoiceListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.clearVoiceListeningWindow(params),
      getVoiceIssueCandidate: (collectedData) =>
        this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData),
      continueAfterSideQuestionWithIssueRouting: (params) =>
        this.continueAfterSideQuestionWithIssueRouting(params),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      log: (payload) => this.deps.loggingService.log(payload, LOGGER_CONTEXT),
    });
    r.turnAddressExistingCandidateRuntime =
      new VoiceTurnAddressExistingCandidateRuntime({
        sanitizer: this.deps.sanitizationService,
        updateVoiceAddressState: (params) =>
          this.deps.voiceConversationStateService.updateVoiceAddressState(params),
        replyWithAddressConfirmationWindow: (params) =>
          this.replyWithAddressConfirmationWindow(params),
        isSoftConfirmationEligible: (
          fieldType,
          candidate,
          utterance,
          confidence,
        ) =>
          this.deps.voiceTurnPolicyService.isSoftConfirmationEligible({
            fieldType,
            candidate,
            utterance,
            confidence,
            minConfidence: this.config.voiceSoftConfirmMinConfidence ?? 0.85,
          }),
        replyWithListeningWindow: (params) =>
          this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
        buildAddressSoftConfirmationTwiml: (candidate, strategy) =>
          this.deps.voicePromptComposer.buildAddressSoftConfirmationTwiml(
            candidate,
            strategy,
          ),
        resolveConfirmation: (utterance, currentCandidate, fieldType) =>
          this.resolveConfirmation(utterance, currentCandidate, fieldType),
        routeAddressCompleteness: (params) =>
          r.turnAddressCompletenessRuntime.routeAddressCompleteness(params),
        handleAddressConfirmedContinuation: (params) =>
          r.turnAddressConfirmedRuntime.handleAddressConfirmedContinuation(
            params,
          ),
        deferAddressToSmsAuthority: (params) =>
          this.deferAddressToSmsAuthority(params),
        replyWithAddressPromptWindow: (params) =>
          this.replyWithAddressPromptWindow(params),
        buildYesNoRepromptTwiml: (strategy) =>
          this.deps.voicePromptComposer.buildYesNoRepromptTwiml(strategy),
      });
    r.turnAddressRoutingRuntime = new VoiceTurnAddressRoutingRuntime({
      sanitizer: this.deps.sanitizationService,
      deferAddressToSmsAuthority: (params) =>
        this.deferAddressToSmsAuthority(params),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildSayGatherTwiml: (message, options) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message, options),
      buildAddressPromptForState: (addressState, strategy) =>
        this.buildAddressPromptForState(addressState, strategy),
      updateVoiceAddressState: (params) =>
        this.deps.voiceConversationStateService.updateVoiceAddressState(params),
      handleMissingLocalityPrompt: (params) =>
        this.handleMissingLocalityPrompt(params),
      replyWithAddressPromptWindow: (params) =>
        this.replyWithAddressPromptWindow(params),
      replyWithAddressConfirmationWindow: (params) =>
        this.replyWithAddressConfirmationWindow(params),
      routeAddressCompleteness: (params) =>
        r.turnAddressCompletenessRuntime.routeAddressCompleteness(params),
      handleAddressExistingCandidate: (params) =>
        r.turnAddressExistingCandidateRuntime.handleAddressExistingCandidate(
          params,
        ),
      buildSideQuestionReply: (tenantId, transcript) =>
        r.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
    });
    r.turnSideQuestionRoutingRuntime =
      new VoiceTurnSideQuestionRoutingRuntime({
        replyWithSideQuestionAndContinue: (params) =>
          r.turnSideQuestionHelperRuntime.replyWithSideQuestionAndContinue(
            params,
          ),
        getVoiceIssueCandidate: (collectedData) =>
          this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData),
        clearIssuePromptAttempts: (callSid) =>
          this.deps.voiceResponseService.clearIssuePromptAttempts(callSid),
        shouldDiscloseFees: (params) =>
          this.deps.voiceTurnPolicyService.shouldDiscloseFees(params),
        getTenantFeePolicySafe: (tenantId) =>
          this.deps.voiceHandoffPolicy.getTenantFeePolicySafe(tenantId),
        buildSmsHandoffMessageForContext: (params) =>
          this.deps.voiceSmsHandoffService.buildSmsHandoffMessageForContext({
            feePolicy: params.feePolicy as PrismaTenantFeePolicy | null,
            includeFees: params.includeFees,
            isEmergency: params.isEmergency,
            callerFirstName: params.callerFirstName,
          }),
        isUrgencyEmergency: (collectedData) =>
          this.deps.voiceTurnPolicyService.isUrgencyEmergency(collectedData),
        getVoiceNameCandidate: (nameState) =>
          this.deps.voiceTurnPolicyService.getVoiceNameCandidate(nameState),
        replyWithSmsHandoff: (params) =>
          r.turnHandoffRuntime.replyWithSmsHandoff(params),
        replyWithIssueCaptureRecovery: (params) =>
          this.replyWithIssueCaptureRecovery(params),
        replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
        buildSayGatherTwiml: (message) =>
          this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      });
    r.turnIssueRecoveryRuntime = new VoiceTurnIssueRecoveryRuntime({
      getVoiceIssueCandidate: (collectedData) =>
        this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData),
      normalizeIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.normalizeIssueCandidate(value),
      buildFallbackIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.buildFallbackIssueCandidate(value),
      isLikelyIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.isLikelyIssueCandidate(value),
      getIssuePromptAttempts: (callSid) =>
        this.deps.voiceResponseService.getIssuePromptAttempts(callSid),
      setIssuePromptAttempts: (callSid, count) =>
        this.deps.voiceResponseService.setIssuePromptAttempts(callSid, count),
      clearIssuePromptAttempts: (callSid) =>
        this.deps.voiceResponseService.clearIssuePromptAttempts(callSid),
      isLikelyQuestion: (value) =>
        this.deps.voiceUtteranceService.isLikelyQuestion(value),
      updateVoiceIssueCandidate: (params) =>
        this.deps.voiceConversationStateService.updateVoiceIssueCandidate(params),
      shouldDiscloseFees: (params) =>
        this.deps.voiceTurnPolicyService.shouldDiscloseFees(params),
      getTenantFeePolicySafe: (tenantId) =>
        this.deps.voiceHandoffPolicy.getTenantFeePolicySafe(tenantId),
      buildSmsHandoffMessageForContext: (params) =>
        this.deps.voiceSmsHandoffService.buildSmsHandoffMessageForContext({
          feePolicy: params.feePolicy as PrismaTenantFeePolicy | null,
          includeFees: params.includeFees,
          isEmergency: params.isEmergency,
          callerFirstName: params.callerFirstName,
        }),
      isUrgencyEmergency: (collectedData) =>
        this.deps.voiceTurnPolicyService.isUrgencyEmergency(collectedData),
      getVoiceNameCandidate: (nameState) =>
        this.deps.voiceTurnPolicyService.getVoiceNameCandidate(nameState),
      replyWithSmsHandoff: (params) =>
        r.turnHandoffRuntime.replyWithSmsHandoff(params),
      log: (payload, context) => this.deps.loggingService.log(payload, context),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
      replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      loggerContext: LOGGER_CONTEXT,
    });
    r.turnHandoffRuntime = new VoiceTurnHandoffRuntime({
      clearIssuePromptAttempts: (callSid) =>
        this.deps.voiceResponseService.clearIssuePromptAttempts(callSid),
      prepareSmsHandoff: (params) =>
        this.deps.voiceSmsHandoffService.prepare({
          ...params,
          loggerContext: LOGGER_CONTEXT,
        }),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildSayGatherTwiml: (message, options) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message, options),
      buildAskSmsNumberTwiml: () =>
        this.deps.voicePromptComposer.buildAskSmsNumberTwiml(),
      sendVoiceHandoffIntakeLink: (params) =>
        this.deps.paymentsService.sendVoiceHandoffIntakeLink(params),
      isUrgencyEmergency: (collectedData) =>
        this.deps.voiceTurnPolicyService.isUrgencyEmergency(collectedData),
      resolveSmsHandoffClosingMessage: (params) =>
        this.deps.voiceSmsHandoffService.resolveSmsHandoffClosingMessage({
          tenantId: params.tenantId,
          isEmergency: this.deps.voiceTurnPolicyService.isUrgencyEmergency(
            params.collectedData,
          ),
          messageOverride: params.messageOverride,
          callerFirstName: params.callerFirstName,
        }),
      buildClosingTwiml: (displayName, message) =>
        this.deps.voicePromptComposer.buildClosingTwiml(displayName, message),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
      replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      log: (payload) => this.deps.loggingService.log(payload, LOGGER_CONTEXT),
      warn: (payload) =>
        this.deps.loggingService.warn(payload, LOGGER_CONTEXT),
    });
    r.turnAiTriageRuntime = new VoiceTurnAiTriageRuntime({
      getVoiceIssueCandidate: (collectedData) =>
        this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData),
      clearIssuePromptAttempts: (callSid) =>
        this.deps.voiceResponseService.clearIssuePromptAttempts(callSid),
      normalizeIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.normalizeIssueCandidate(value),
      isLikelyIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.isLikelyIssueCandidate(value),
      updateVoiceIssueCandidate: (params) =>
        this.deps.voiceConversationStateService.updateVoiceIssueCandidate(params),
      replyWithIssueCaptureRecovery: (params) =>
        this.replyWithIssueCaptureRecovery(params),
      isIssueRepeatComplaint: (value) =>
        this.deps.voiceTurnPolicyService.isIssueRepeatComplaint(value),
      triage: (params) =>
        this.trackAiCall(params.timingCollector, () =>
          this.deps.aiService.triage(
            params.tenantId,
            params.callSid,
            params.triageInput,
            {
              conversationId: params.conversationId,
              channel: CommunicationChannel.VOICE,
            },
          ),
        ),
      buildSmsHandoffMessage: (callerFirstName) =>
        this.deps.voiceSmsHandoffService.buildSmsHandoffMessage(callerFirstName),
      shouldDiscloseFees: (params) =>
        this.deps.voiceTurnPolicyService.shouldDiscloseFees(params),
      getTenantFeePolicySafe: (tenantId) =>
        this.deps.voiceHandoffPolicy.getTenantFeePolicySafe(tenantId),
      buildSmsHandoffMessageForContext: (params) =>
        this.deps.voiceSmsHandoffService.buildSmsHandoffMessageForContext({
          feePolicy: params.feePolicy as PrismaTenantFeePolicy | null,
          includeFees: params.includeFees,
          isEmergency: params.isEmergency,
          callerFirstName: params.callerFirstName,
        }),
      isUrgencyEmergency: (collectedData) =>
        this.deps.voiceTurnPolicyService.isUrgencyEmergency(collectedData),
      getVoiceNameCandidate: (nameState) =>
        this.deps.voiceTurnPolicyService.getVoiceNameCandidate(nameState),
      replyWithSmsHandoff: (params) =>
        r.turnHandoffRuntime.replyWithSmsHandoff(params),
      normalizeConfirmationUtterance: (value) =>
        normalizeConfirmationUtterance(value),
      replyWithTwiml: (res, twiml) => this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      isHumanFallbackMessage: (message) =>
        r.turnHandoffRuntime.isHumanFallbackMessage(message),
      replyWithHumanFallback: (params) => this.deps.voiceResponseService.replyWithHumanFallback(params),
      isLikelyQuestion: (transcript) =>
        this.deps.voiceUtteranceService.isLikelyQuestion(transcript),
      isBookingIntent: (transcript) =>
        this.deps.voiceUtteranceService.isBookingIntent(transcript),
      replyWithBookingOffer: (params) => this.replyWithBookingOffer(params),
      logVoiceOutcome: (params) =>
        r.turnHandoffRuntime.logVoiceOutcome(params),
      buildTwiml: (message) => this.deps.voicePromptComposer.buildTwiml(message),
      replyWithNoHandoff: (params) => this.deps.voiceResponseService.replyWithNoHandoff(params),
      warn: (payload, context) => this.deps.loggingService.warn(payload, context),
      loggerContext: LOGGER_CONTEXT,
    });
    r.turnSideQuestionRuntime = new VoiceTurnSideQuestionRuntime({
      resolveBinaryUtterance: (transcript) =>
        this.deps.voiceUtteranceService.resolveBinaryUtterance(transcript),
      isFrustrationRequest: (transcript) =>
        this.deps.voiceUtteranceService.isFrustrationRequest(transcript),
      clearVoiceListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.clearVoiceListeningWindow(params),
      replyWithSideQuestionAndContinue: (params) =>
        r.turnSideQuestionHelperRuntime.replyWithSideQuestionAndContinue(
          params,
        ),
      getVoiceIssueCandidate: (collectedData) =>
        this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData),
      buildAskNameTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildAskNameTwiml(strategy),
      prependPrefaceToGatherTwiml: (preface, twiml) =>
        this.deps.voicePromptComposer.prependPrefaceToGatherTwiml(preface, twiml),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildAddressPromptForState: (addressState, strategy) =>
        this.buildAddressPromptForState(addressState, strategy),
      replyWithIssueCaptureRecovery: (params) =>
        this.replyWithIssueCaptureRecovery(params),
      continueAfterSideQuestionWithIssueRouting: (params) =>
        this.continueAfterSideQuestionWithIssueRouting(params),
      buildSideQuestionReply: (tenantId, transcript) =>
        r.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
      updateVoiceUrgencyConfirmation: (params) =>
        this.deps.voiceConversationStateService.updateVoiceUrgencyConfirmation(params),
      buildUrgencyConfirmTwiml: (strategy, context) =>
        this.buildUrgencyConfirmTwiml(strategy, context),
      getVoiceNameCandidate: (nameState) =>
        this.deps.voiceTurnPolicyService.getVoiceNameCandidate(nameState),
    });

    return r;
  }

  // ─── Coordination methods ────────────────────────────────────────────────
  // These were private methods on VoiceTurnService that are only invoked from
  // within runtime lambdas (never from processTurn directly). Moving them here
  // keeps them co-located with the wiring that needs them.

  private buildUrgencyConfirmTwiml(
    strategy?: CsrStrategy,
    context?: {
      callerName?: string | null;
      issueCandidate?: string | null;
    },
  ): string {
    return this.deps.voicePromptComposer.buildUrgencyConfirmTwiml(strategy, {
      callerName: context?.callerName,
      issueSummary: context?.issueCandidate
        ? this.deps.voiceTurnPolicyService.buildIssueAcknowledgement(
            context.issueCandidate,
          )
        : null,
    });
  }

  private async handleMissingLocalityPrompt(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    candidate: string;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    collectedData: unknown;
    currentEventId: string | null;
    displayName: string;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }) {
    const nextAttempt = params.addressState.attemptCount + 1;
    const shouldFailClosed = nextAttempt >= 2;
    const nextAddressState: typeof params.addressState = {
      ...params.addressState,
      candidate: params.candidate,
      status: shouldFailClosed ? "FAILED" : "CANDIDATE",
      attemptCount: nextAttempt,
      needsLocality: !shouldFailClosed,
      sourceEventId: params.currentEventId,
    };
    await this.deps.voiceConversationStateService.updateVoiceAddressState({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      addressState: nextAddressState,
    });
    if (shouldFailClosed) {
      return this.deferAddressToSmsAuthority({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        currentEventId: params.currentEventId,
        addressState: nextAddressState,
        nameState: params.nameState,
        collectedData: params.collectedData,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      });
    }
    return this.deps.voiceListeningWindowService.replyWithListeningWindow({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      field: "address",
      sourceEventId: params.currentEventId,
      twiml: this.deps.voicePromptComposer.buildAddressLocalityPromptTwiml(
        params.strategy,
      ),
    });
  }

  private async deferAddressToSmsAuthority(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    currentEventId: string | null;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    collectedData: unknown;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }) {
    const nextAddressState: typeof params.addressState = {
      ...params.addressState,
      status: "FAILED",
      smsConfirmNeeded: true,
      needsLocality: false,
      sourceEventId:
        params.currentEventId ?? params.addressState.sourceEventId ?? null,
    };
    await this.deps.voiceConversationStateService.updateVoiceAddressState({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      addressState: nextAddressState,
    });
    this.deps.loggingService.log(
      {
        event: "voice.address_deferred_to_sms",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        attemptCount: nextAddressState.attemptCount,
        candidate: nextAddressState.candidate,
        confidence: nextAddressState.confidence,
      },
      LOGGER_CONTEXT,
    );
    await this.deps.voiceListeningWindowService.clearVoiceListeningWindow({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });

    const issueCandidate =
      this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(params.collectedData);
    if (issueCandidate?.value) {
      const includeFees = this.deps.voiceTurnPolicyService.shouldDiscloseFees({
        nameState: params.nameState,
        addressState: nextAddressState,
        collectedData: params.collectedData,
      });
      const feePolicy = includeFees
        ? await this.deps.voiceHandoffPolicy.getTenantFeePolicySafe(params.tenantId)
        : null;
      const smsMessage =
        this.deps.voiceSmsHandoffService.buildSmsHandoffMessageForContext({
          feePolicy,
          includeFees,
          isEmergency: this.deps.voiceTurnPolicyService.isUrgencyEmergency(
            params.collectedData,
          ),
          callerFirstName: this.deps.voiceTurnPolicyService
            .getVoiceNameCandidate(params.nameState)
            ?.split(" ")
            .filter(Boolean)[0],
        });
      return this.runtimes.turnHandoffRuntime.replyWithSmsHandoff({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        reason: "address_deferred_sms_handoff",
        messageOverride: smsMessage,
      });
    }

    const message =
      "No problem—I'll confirm the address by text after we finish. What's been going on with the system?";
    return this.deps.voiceResponseService.replyWithTwiml(
      params.res,
      this.deps.voicePromptComposer.buildSayGatherTwiml(
        this.applyCsrStrategy(params.strategy, message),
      ),
    );
  }

  private selectCsrStrategy(params: {
    conversation: { currentFSMState?: string | null };
    collectedData: unknown;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
  }): CsrStrategy {
    const hasConfirmedName =
      Boolean(params.nameState.confirmed.value) ||
      this.deps.voiceTurnPolicyService.isVoiceFieldReady(
        params.nameState.locked,
        params.nameState.confirmed.value,
      );
    const hasConfirmedAddress =
      Boolean(params.addressState.confirmed) ||
      this.deps.voiceTurnPolicyService.isVoiceFieldReady(
        params.addressState.locked,
        params.addressState.confirmed,
      ) ||
      Boolean(params.addressState.smsConfirmNeeded);
    return this.deps.csrStrategySelector.selectStrategy({
      channel: CommunicationChannel.VOICE,
      fsmState: params.conversation.currentFSMState ?? null,
      hasConfirmedName,
      hasConfirmedAddress,
      urgency: this.deps.voiceTurnPolicyService.isUrgencyEmergency(
        params.collectedData,
      ),
      isPaymentRequiredNext: this.deps.voiceTurnPolicyService.isPaymentRequiredNext(
        params.collectedData,
      ),
    });
  }

  private applyCsrStrategy(
    strategy: CsrStrategy | undefined,
    message: string,
  ): string {
    return this.deps.voicePromptComposer.applyCsrStrategy(strategy, message);
  }

  private async replyWithAddressPromptWindow(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    strategy?: CsrStrategy;
  }): Promise<string> {
    return this.deps.voiceListeningWindowService.replyWithListeningWindow({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      field: "address",
      sourceEventId: params.sourceEventId,
      twiml: this.buildAddressPromptForState(
        params.addressState,
        params.strategy,
      ),
    });
  }

  private async replyWithAddressConfirmationWindow(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
    candidate: string;
    strategy?: CsrStrategy;
  }): Promise<string> {
    return this.deps.voiceListeningWindowService.replyWithListeningWindow({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      field: "confirmation",
      targetField: "address",
      sourceEventId: params.sourceEventId,
      twiml: this.deps.voicePromptComposer.buildAddressConfirmationTwiml(
        params.candidate,
        params.strategy,
      ),
    });
  }

  private async markVoiceEventProcessed(params: {
    tenantId: string;
    conversationId: string;
    eventId: string;
  }) {
    await this.deps.voiceConversationStateService.updateVoiceLastEventId(params);
  }

  private resolveConfirmation(
    utterance: string,
    currentCandidate: string | null,
    fieldType: "name" | "address",
  ): VoiceConfirmationResolution {
    return resolveConfirmation({
      utterance,
      currentCandidate,
      fieldType,
      sanitizer: this.deps.sanitizationService,
    });
  }

  private async continueAfterSideQuestionWithIssueRouting(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    sideQuestionReply: string;
    expectedField: VoiceListeningField | null;
    nameReady: boolean;
    addressReady: boolean;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    collectedData: unknown;
    currentEventId: string | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string> {
    return this.runtimes.turnSideQuestionRoutingRuntime.continueAfterSideQuestionWithIssueRouting(
      {
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        sideQuestionReply: params.sideQuestionReply,
        expectedField: params.expectedField,
        nameReady: params.nameReady,
        addressReady: params.addressReady,
        nameState: params.nameState,
        addressState: params.addressState,
        collectedData:
          (params.collectedData as Prisma.JsonValue | null) ?? null,
        currentEventId: params.currentEventId,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      },
    );
  }

  private async replyWithIssueCaptureRecovery(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    collectedData: unknown;
    strategy?: CsrStrategy;
    reason: string;
    promptPrefix?: string;
    transcript?: string;
  }): Promise<string> {
    return this.runtimes.turnIssueRecoveryRuntime.replyWithIssueCaptureRecovery({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      displayName: params.displayName,
      nameState: params.nameState,
      addressState: params.addressState,
      collectedData: (params.collectedData as Prisma.JsonValue | null) ?? null,
      strategy: params.strategy,
      reason: params.reason,
      promptPrefix: params.promptPrefix,
      transcript: params.transcript,
    });
  }

  private async replyWithBookingOffer(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    sourceEventId: string | null;
    message: string;
    strategy?: CsrStrategy;
  }) {
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

  private normalizeCsrStrategyForTurn(
    strategy: CsrStrategy,
    turnCount: number,
  ): CsrStrategy | undefined {
    if (turnCount <= 1) {
      return strategy;
    }
    if (strategy === CsrStrategy.OPENING || strategy === CsrStrategy.EMPATHY) {
      return undefined;
    }
    return strategy;
  }

  private buildAddressPromptForState(
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>,
    strategy?: CsrStrategy,
  ): string {
    return this.deps.voiceAddressPromptService.buildAddressPromptForState({
      addressState,
      strategy,
      applyCsrStrategy: (runtimeStrategy, message) =>
        this.applyCsrStrategy(runtimeStrategy, message),
    });
  }
}
