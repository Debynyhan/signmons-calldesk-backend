import { Inject, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  CommunicationChannel,
  Prisma,
  TenantOrganization,
} from "@prisma/client";
import type { TenantFeePolicy as PrismaTenantFeePolicy } from "@prisma/client";
import appConfig, { type AppConfig } from "../config/app.config";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { ConversationsService } from "../conversations/conversations.service";
import { CallLogService } from "../logging/call-log.service";
import { LoggingService } from "../logging/logging.service";
import { AiService } from "../ai/ai.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { CsrStrategy, CsrStrategySelector } from "./csr-strategy.selector";
import { VoiceHandoffPolicyService } from "./voice-handoff-policy.service";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";
import { VoiceSmsHandoffService } from "./voice-sms-handoff.service";
import { VoiceSmsPhoneSlotService } from "./voice-sms-phone-slot.service";
import { VoiceUrgencySlotService } from "./voice-urgency-slot.service";
import { PaymentsService } from "../payments/payments.service";
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
import * as voiceAddressCandidatePolicy from "./intake/voice-address-candidate.policy";
import {
  normalizeConfirmationUtterance,
  resolveConfirmation,
  stripConfirmationPrefix,
  type VoiceConfirmationResolution,
} from "./intake/voice-field-confirmation.policy";
import {
  buildVoiceFallbackIssueCandidate,
  buildVoiceIssueAcknowledgement,
  isLikelyVoiceIssueCandidate,
  isVoiceComfortRiskRelevant,
  isVoiceIssueRepeatComplaint,
  normalizeVoiceIssueCandidate,
} from "./intake/voice-issue-candidate.policy";
import {
  buildVoiceListeningWindowReprompt,
  getExpectedVoiceListeningField,
  isVoiceListeningWindowExpired,
  shouldClearVoiceListeningWindow,
} from "./intake/voice-listening-window.policy";
import {
  extractVoiceSmsPhoneCandidate,
  getVoiceCallerPhoneFromCollectedData,
  isVoiceSmsNumberConfirmation,
} from "./intake/voice-sms-phone-confirmation.policy";
import { shouldIgnoreVoiceStreamingTranscript } from "./intake/voice-streaming-transcript.policy";
import { reduceVoiceTurnPlanner } from "./intake/voice-turn-planner.reducer";
import {
  getRequestContext,
  setRequestContextData,
} from "../common/context/request-context";
import {
  isAffirmativeUtterance as isAffirmativeUtterancePolicy,
  isBookingIntent as isBookingIntentPolicy,
  isDuplicateTranscript as isDuplicateTranscriptPolicy,
  isFrustrationRequest as isFrustrationRequestPolicy,
  isHangupRequest as isHangupRequestPolicy,
  isHumanTransferRequest as isHumanTransferRequestPolicy,
  isLikelyQuestion as isLikelyQuestionPolicy,
  isNegativeUtterance as isNegativeUtterancePolicy,
  isSlowDownRequest as isSlowDownRequestPolicy,
  isSmsDifferentNumberRequest as isSmsDifferentNumberRequestPolicy,
  resolveBinaryUtterance as resolveBinaryUtterancePolicy,
} from "./voice-utterance.policy";
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
type VoiceComfortRiskResponse = "YES" | "NO";
type VoiceComfortRisk = {
  askedAt: string | null;
  response: VoiceComfortRiskResponse | null;
  sourceEventId: string | null;
};
type VoiceUrgencyConfirmationResponse = "YES" | "NO";
type VoiceUrgencyConfirmation = {
  askedAt: string | null;
  response: VoiceUrgencyConfirmationResponse | null;
  sourceEventId: string | null;
};
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

@Injectable()
export class VoiceTurnService {
  private readonly lastResponseByCall = new Map<
    string,
    { twiml: string; at: number }
  >();
  private readonly issuePromptAttemptsByCall = new Map<string, number>();
  private readonly turnPreludeRuntime: VoiceTurnPreludeRuntime;
  private readonly turnContextRuntime: VoiceTurnContextRuntime;
  private readonly turnEarlyRoutingRuntime: VoiceTurnEarlyRoutingRuntime;
  private readonly turnExpectedFieldRuntime: VoiceTurnExpectedFieldRuntime;
  private readonly turnIssueRecoveryRuntime: VoiceTurnIssueRecoveryRuntime;
  private readonly turnInterruptRuntime: VoiceTurnInterruptRuntime;
  private readonly turnAiTriageRuntime: VoiceTurnAiTriageRuntime;
  private readonly turnNameOpeningRuntime: VoiceTurnNameOpeningRuntime;
  private readonly turnNameCaptureRuntime: VoiceTurnNameCaptureRuntime;
  private readonly turnNameFlowRuntime: VoiceTurnNameFlowRuntime;
  private readonly turnNameSpellingRuntime: VoiceTurnNameSpellingRuntime;
  private readonly turnAddressExtractionRuntime: VoiceTurnAddressExtractionRuntime;
  private readonly turnAddressRoutingRuntime: VoiceTurnAddressRoutingRuntime;
  private readonly turnAddressCompletenessRuntime: VoiceTurnAddressCompletenessRuntime;
  private readonly turnAddressConfirmedRuntime: VoiceTurnAddressConfirmedRuntime;
  private readonly turnAddressExistingCandidateRuntime: VoiceTurnAddressExistingCandidateRuntime;
  private readonly turnSideQuestionHelperRuntime: VoiceTurnSideQuestionHelperRuntime;
  private readonly turnSideQuestionRoutingRuntime: VoiceTurnSideQuestionRoutingRuntime;
  private readonly turnSideQuestionRuntime: VoiceTurnSideQuestionRuntime;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    private readonly conversationsService: ConversationsService,
    private readonly callLogService: CallLogService,
    private readonly aiService: AiService,
    private readonly loggingService: LoggingService,
    private readonly sanitizationService: SanitizationService,
    private readonly csrStrategySelector: CsrStrategySelector,
    private readonly voicePromptComposer: VoicePromptComposerService,
    private readonly voiceHandoffPolicy: VoiceHandoffPolicyService,
    private readonly voiceSmsHandoffService: VoiceSmsHandoffService,
    private readonly voiceSmsPhoneSlotService: VoiceSmsPhoneSlotService,
    private readonly voiceUrgencySlotService: VoiceUrgencySlotService,
    private readonly paymentsService: PaymentsService,
  ) {
    this.turnPreludeRuntime = new VoiceTurnPreludeRuntime(
      this.config,
      this.conversationsService,
      this.callLogService,
      {
        getVoiceListeningWindow: (collectedData) =>
          this.getVoiceListeningWindow(collectedData),
        getExpectedListeningField: (listeningWindow) =>
          this.getExpectedListeningField(
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
              this.getVoiceListeningWindow(collectedData)?.field ===
              "confirmation",
            isSlowDownRequest: (value) => this.isSlowDownRequest(value),
            isFrustrationRequest: (value) => this.isFrustrationRequest(value),
            isHumanTransferRequest: (value) =>
              this.isHumanTransferRequest(value),
            isSmsDifferentNumberRequest: (value) =>
              this.isSmsDifferentNumberRequest(value),
            isHangupRequest: (value) => this.isHangupRequest(value),
            resolveBinaryUtterance: (value) =>
              this.resolveBinaryUtterance(value),
            normalizeNameCandidate: (value) =>
              normalizeNameCandidate(value, this.sanitizationService),
            isValidNameCandidate: (value) => isValidNameCandidate(value),
            isLikelyNameCandidate: (value) => isLikelyNameCandidate(value),
            normalizeIssueCandidate: (value) =>
              this.normalizeIssueCandidate(value),
            isLikelyIssueCandidate: (value) =>
              this.isLikelyIssueCandidate(value),
            normalizeConfirmationUtterance: (value) =>
              this.normalizeConfirmationUtterance(value),
            isSmsNumberConfirmation: (value) =>
              isVoiceSmsNumberConfirmation(value),
          }),
        isDuplicateTranscript: (collectedData, transcript, now) =>
          this.isDuplicateTranscript(collectedData, transcript, now),
        normalizeConfidence: (value) => this.normalizeConfidence(value),
        getTenantDisplayName: (tenant) => this.getTenantDisplayName(tenant),
        buildRepromptTwiml: () => this.buildRepromptTwiml(),
        buildSayGatherTwiml: (message) => this.buildSayGatherTwiml(message),
        replyWithTwiml: (res, twiml) => this.replyWithTwiml(res, twiml),
        replyWithNoHandoff: (params) => this.replyWithNoHandoff(params),
        replyWithHumanFallback: (params) => this.replyWithHumanFallback(params),
      },
    );
    this.turnContextRuntime = new VoiceTurnContextRuntime(this.loggingService, {
      getVoiceNameState: (collectedData) =>
        this.conversationsService.getVoiceNameState(collectedData),
      getVoiceSmsPhoneState: (collectedData) =>
        this.conversationsService.getVoiceSmsPhoneState(collectedData),
      getVoiceAddressState: (collectedData) =>
        this.conversationsService.getVoiceAddressState(collectedData),
      selectCsrStrategy: (params) => this.selectCsrStrategy(params),
      normalizeCsrStrategyForTurn: (strategy, turnCount) =>
        this.normalizeCsrStrategyForTurn(strategy, turnCount),
      getVoiceListeningWindow: (collectedData) =>
        this.getVoiceListeningWindow(collectedData),
      shouldClearListeningWindow: (
        listeningWindow,
        now,
        nameState,
        addressState,
        phoneState,
      ) =>
        this.shouldClearListeningWindow(
          listeningWindow,
          now,
          nameState,
          addressState,
          phoneState,
        ),
      clearVoiceListeningWindow: (params) =>
        this.clearVoiceListeningWindow(params),
      getVoiceLastEventId: (collectedData) =>
        this.getVoiceLastEventId(collectedData),
      replyWithTwiml: (res, twiml) => this.replyWithTwiml(res, twiml),
      buildListeningWindowReprompt: (params) =>
        this.buildListeningWindowReprompt(params),
      markVoiceEventProcessed: (params) => this.markVoiceEventProcessed(params),
      getExpectedListeningField: (window) =>
        this.getExpectedListeningField(window),
      isVoiceFieldReady: (locked, confirmed) =>
        this.isVoiceFieldReady(locked, confirmed),
    });
    this.turnEarlyRoutingRuntime = new VoiceTurnEarlyRoutingRuntime({
      resolveBinaryUtterance: (transcript) =>
        this.resolveBinaryUtterance(transcript),
      isBookingIntent: (transcript) => this.isBookingIntent(transcript),
      clearVoiceListeningWindow: (params) =>
        this.clearVoiceListeningWindow(params),
      replyWithTwiml: (res, twiml) => this.replyWithTwiml(res, twiml),
      buildSayGatherTwiml: (message) => this.buildSayGatherTwiml(message),
      replyWithListeningWindow: (params) =>
        this.replyWithListeningWindow(params),
      buildBookingPromptTwiml: (strategy) =>
        this.buildBookingPromptTwiml(strategy),
      replyWithHumanFallback: (params) => this.replyWithHumanFallback(params),
      buildCallbackOfferTwiml: (strategy) =>
        this.buildCallbackOfferTwiml(strategy),
      handleExpectedUrgencyField: (params) =>
        this.voiceUrgencySlotService.handleExpectedField(params),
      continueAfterSideQuestionWithIssueRouting: (params) =>
        this.continueAfterSideQuestionWithIssueRouting(params),
      buildUrgencyConfirmTwiml: (strategy, opts) =>
        this.buildUrgencyConfirmTwiml(strategy, opts),
    });
    this.turnExpectedFieldRuntime = new VoiceTurnExpectedFieldRuntime({
      getVoiceSmsHandoff: (collectedData) =>
        this.conversationsService.getVoiceSmsHandoff(collectedData),
      getCallerPhoneFromCollectedData: (collectedData) =>
        getVoiceCallerPhoneFromCollectedData(collectedData),
      normalizeConfirmationUtterance: (value) =>
        this.normalizeConfirmationUtterance(value),
      isSmsNumberConfirmation: (transcript) =>
        isVoiceSmsNumberConfirmation(transcript),
      extractSmsPhoneCandidate: (transcript) =>
        extractVoiceSmsPhoneCandidate(transcript, (value) =>
          this.sanitizationService.normalizePhoneE164(value),
        ),
      handleExpectedSmsPhoneField: (params) =>
        this.voiceSmsPhoneSlotService.handleExpectedField(params),
      replyWithSmsHandoff: (params) => this.replyWithSmsHandoff(params),
      replyWithListeningWindow: (params) =>
        this.replyWithListeningWindow(params),
      buildAskSmsNumberTwiml: (strategy) =>
        this.buildAskSmsNumberTwiml(strategy),
      replyWithHumanFallback: (params) => this.replyWithHumanFallback(params),
      loggerContext: VoiceTurnService.name,
    });
    this.turnInterruptRuntime = new VoiceTurnInterruptRuntime(
      {
        isSlowDownRequest: (transcript) => this.isSlowDownRequest(transcript),
        replyWithListeningWindow: (params) =>
          this.replyWithListeningWindow(params),
        buildTakeYourTimeTwiml: (field, strategy) =>
          this.buildTakeYourTimeTwiml(field, strategy),
        replyWithTwiml: (res, twiml) => this.replyWithTwiml(res, twiml),
        buildSayGatherTwiml: (message) => this.buildSayGatherTwiml(message),
      },
      {
        isHangupRequest: (transcript) => this.isHangupRequest(transcript),
        clearIssuePromptAttempts: (callSid) =>
          this.clearIssuePromptAttempts(callSid),
        replyWithTwiml: (res, twiml) => this.replyWithTwiml(res, twiml),
        buildTwiml: (message) => this.buildTwiml(message),
        isHumanTransferRequest: (transcript) =>
          this.isHumanTransferRequest(transcript),
        replyWithListeningWindow: (params) =>
          this.replyWithListeningWindow(params),
        buildCallbackOfferTwiml: (strategy) =>
          this.buildCallbackOfferTwiml(strategy),
        isSmsDifferentNumberRequest: (transcript) =>
          this.isSmsDifferentNumberRequest(transcript),
        updateVoiceSmsHandoff: (params) =>
          this.conversationsService.updateVoiceSmsHandoff(params),
        updateVoiceSmsPhoneState: (params) =>
          this.conversationsService.updateVoiceSmsPhoneState(params),
        buildAskSmsNumberTwiml: (strategy) =>
          this.buildAskSmsNumberTwiml(strategy),
      },
    );
    this.turnSideQuestionHelperRuntime = new VoiceTurnSideQuestionHelperRuntime(
      {
        normalizeWhitespace: (value) =>
          this.sanitizationService.normalizeWhitespace(value),
        stripConfirmationPrefix: (value) => this.stripConfirmationPrefix(value),
        isLikelyQuestion: (value) => this.isLikelyQuestion(value),
        getTenantFeePolicySafe: (tenantId) =>
          this.getTenantFeePolicySafe(tenantId),
        getTenantFeeConfig: (policy) =>
          this.getTenantFeeConfig(policy as PrismaTenantFeePolicy | null),
        formatFeeAmount: (value) => this.formatFeeAmount(value),
        getTenantDisplayNameById: async (tenantId) => {
          try {
            const tenant = await this.tenantsService.getTenantContext(tenantId);
            return tenant.displayName;
          } catch {
            return null;
          }
        },
        buildAskNameTwiml: (strategy) => this.buildAskNameTwiml(strategy),
        prependPrefaceToGatherTwiml: (preface, twiml) =>
          this.prependPrefaceToGatherTwiml(preface, twiml),
        replyWithListeningWindow: (params) =>
          this.replyWithListeningWindow(params),
        buildAddressPromptForState: (addressState, strategy) =>
          this.buildAddressPromptForState(addressState, strategy),
        buildAskSmsNumberTwiml: (strategy) =>
          this.buildAskSmsNumberTwiml(strategy),
        buildBookingPromptTwiml: (strategy) =>
          this.buildBookingPromptTwiml(strategy),
        buildCallbackOfferTwiml: (strategy) =>
          this.buildCallbackOfferTwiml(strategy),
      },
    );
    this.turnNameOpeningRuntime = new VoiceTurnNameOpeningRuntime({
      isOpeningGreetingOnly: (transcript) =>
        this.isOpeningGreetingOnly(transcript),
      extractNameCandidateDeterministic: (transcript) =>
        extractNameCandidateDeterministic(transcript, this.sanitizationService),
      normalizeIssueCandidate: (value) => this.normalizeIssueCandidate(value),
      isLikelyIssueCandidate: (value) => this.isLikelyIssueCandidate(value),
      clearIssuePromptAttempts: (callSid) =>
        this.clearIssuePromptAttempts(callSid),
      updateVoiceIssueCandidate: (params) =>
        this.conversationsService.updateVoiceIssueCandidate(params),
      buildIssueAcknowledgement: (value) =>
        this.buildIssueAcknowledgement(value),
      buildSideQuestionReply: (tenantId, transcript) =>
        this.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
      replyWithBookingOffer: (params) => this.replyWithBookingOffer(params),
      buildSayGatherTwiml: (message) => this.buildSayGatherTwiml(message),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
    });
    this.turnNameCaptureRuntime = new VoiceTurnNameCaptureRuntime({
      normalizeIssueCandidate: (value) => this.normalizeIssueCandidate(value),
      isLikelyIssueCandidate: (value) => this.isLikelyIssueCandidate(value),
      getVoiceIssueCandidate: (collectedData) =>
        this.getVoiceIssueCandidate(collectedData),
      updateVoiceIssueCandidate: (params) =>
        this.conversationsService.updateVoiceIssueCandidate(params),
      buildIssueAcknowledgement: (value) =>
        this.buildIssueAcknowledgement(value),
      buildSideQuestionReply: (tenantId, transcript) =>
        this.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
      replyWithBookingOffer: (params) => this.replyWithBookingOffer(params),
      isLikelyAddressInputForName: (transcript) =>
        this.isLikelyAddressInputForName(transcript),
      extractNameCandidateDeterministic: (transcript) =>
        extractNameCandidateDeterministic(transcript, this.sanitizationService),
      extractNameCandidate: (tenantId, transcript, timingCollector) =>
        this.trackAiCall(timingCollector, () =>
          this.aiService.extractNameCandidate(tenantId, transcript),
        ),
      normalizeNameCandidate: (value) =>
        normalizeNameCandidate(value, this.sanitizationService),
      isValidNameCandidate: (value) => isValidNameCandidate(value),
      isLikelyNameCandidate: (value) => isLikelyNameCandidate(value),
      shouldPromptForNameSpelling: (state, candidate) =>
        shouldPromptForNameSpelling(state, candidate, this.sanitizationService),
      buildAskNameTwiml: (strategy) => this.buildAskNameTwiml(strategy),
      buildSayGatherTwiml: (message) => this.buildSayGatherTwiml(message),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
    });
    this.turnNameFlowRuntime = new VoiceTurnNameFlowRuntime({
      updateVoiceNameState: (params) =>
        this.conversationsService.updateVoiceNameState(params),
      shouldRepromptForLowConfidenceName: (state, candidate) =>
        shouldRepromptForLowConfidenceName(
          state,
          candidate,
          this.sanitizationService,
        ),
      buildNameClarificationPrompt: (candidate) =>
        buildNameClarificationPrompt(candidate, this.sanitizationService),
      shouldPromptForNameSpelling: (state, candidate) =>
        shouldPromptForNameSpelling(state, candidate, this.sanitizationService),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
      buildSayGatherTwiml: (message, options) =>
        this.buildSayGatherTwiml(message, options),
      replyWithListeningWindow: (params) =>
        this.replyWithListeningWindow(params),
      log: (payload) => this.loggingService.log(payload, VoiceTurnService.name),
    });
    this.turnNameSpellingRuntime = new VoiceTurnNameSpellingRuntime({
      parseSpelledNameParts: (transcript) => parseSpelledNameParts(transcript),
      extractNameCandidateDeterministic: (transcript) =>
        extractNameCandidateDeterministic(transcript, this.sanitizationService),
      normalizeNameCandidate: (value) =>
        normalizeNameCandidate(value, this.sanitizationService),
      isValidNameCandidate: (value) => isValidNameCandidate(value),
      isLikelyNameCandidate: (value) => isLikelyNameCandidate(value),
      updateVoiceNameState: (params) =>
        this.conversationsService.updateVoiceNameState(params),
      log: (payload) => this.loggingService.log(payload, VoiceTurnService.name),
    });
    this.turnAddressExtractionRuntime = new VoiceTurnAddressExtractionRuntime({
      sanitizer: this.sanitizationService,
      voiceAddressMinConfidence: this.config.voiceAddressMinConfidence ?? 0.7,
      extractAddressCandidate: (tenantId, transcript, timingCollector) =>
        this.trackAiCall(timingCollector, () =>
          this.aiService.extractAddressCandidate(tenantId, transcript),
        ),
      updateVoiceAddressState: (params) =>
        this.conversationsService.updateVoiceAddressState(params),
      deferAddressToSmsAuthority: (params) =>
        this.deferAddressToSmsAuthority(params),
      replyWithAddressPromptWindow: (params) =>
        this.replyWithAddressPromptWindow(params),
      handleMissingLocalityPrompt: (params) =>
        this.handleMissingLocalityPrompt(params),
      replyWithAddressConfirmationWindow: (params) =>
        this.replyWithAddressConfirmationWindow(params),
    });
    this.turnAddressCompletenessRuntime =
      new VoiceTurnAddressCompletenessRuntime({
        handleMissingLocalityPrompt: (params) =>
          this.handleMissingLocalityPrompt(params),
        replyWithAddressPromptWindow: (params) =>
          this.replyWithAddressPromptWindow(params),
      });
    this.turnAddressConfirmedRuntime = new VoiceTurnAddressConfirmedRuntime({
      updateVoiceAddressState: (params) =>
        this.conversationsService.updateVoiceAddressState(params),
      clearVoiceListeningWindow: (params) =>
        this.clearVoiceListeningWindow(params),
      getVoiceIssueCandidate: (collectedData) =>
        this.getVoiceIssueCandidate(collectedData),
      continueAfterSideQuestionWithIssueRouting: (params) =>
        this.continueAfterSideQuestionWithIssueRouting(params),
      buildSayGatherTwiml: (message) => this.buildSayGatherTwiml(message),
      replyWithTwiml: (res, twiml) => this.replyWithTwiml(res, twiml),
      log: (payload) => this.loggingService.log(payload, VoiceTurnService.name),
    });
    this.turnAddressExistingCandidateRuntime =
      new VoiceTurnAddressExistingCandidateRuntime({
        sanitizer: this.sanitizationService,
        updateVoiceAddressState: (params) =>
          this.conversationsService.updateVoiceAddressState(params),
        replyWithAddressConfirmationWindow: (params) =>
          this.replyWithAddressConfirmationWindow(params),
        isSoftConfirmationEligible: (
          fieldType,
          candidate,
          utterance,
          confidence,
        ) =>
          this.isSoftConfirmationEligible(
            fieldType,
            candidate,
            utterance,
            confidence,
          ),
        replyWithListeningWindow: (params) =>
          this.replyWithListeningWindow(params),
        buildAddressSoftConfirmationTwiml: (candidate, strategy) =>
          this.buildAddressSoftConfirmationTwiml(candidate, strategy),
        resolveConfirmation: (utterance, currentCandidate, fieldType) =>
          this.resolveConfirmation(utterance, currentCandidate, fieldType),
        routeAddressCompleteness: (params) =>
          this.turnAddressCompletenessRuntime.routeAddressCompleteness(params),
        handleAddressConfirmedContinuation: (params) =>
          this.turnAddressConfirmedRuntime.handleAddressConfirmedContinuation(
            params,
          ),
        deferAddressToSmsAuthority: (params) =>
          this.deferAddressToSmsAuthority(params),
        replyWithAddressPromptWindow: (params) =>
          this.replyWithAddressPromptWindow(params),
        buildYesNoRepromptTwiml: (strategy) =>
          this.buildYesNoRepromptTwiml(strategy),
      });
    this.turnAddressRoutingRuntime = new VoiceTurnAddressRoutingRuntime({
      sanitizer: this.sanitizationService,
      deferAddressToSmsAuthority: (params) =>
        this.deferAddressToSmsAuthority(params),
      replyWithListeningWindow: (params) =>
        this.replyWithListeningWindow(params),
      buildSayGatherTwiml: (message, options) =>
        this.buildSayGatherTwiml(message, options),
      buildAddressPromptForState: (addressState, strategy) =>
        this.buildAddressPromptForState(addressState, strategy),
      updateVoiceAddressState: (params) =>
        this.conversationsService.updateVoiceAddressState(params),
      handleMissingLocalityPrompt: (params) =>
        this.handleMissingLocalityPrompt(params),
      replyWithAddressPromptWindow: (params) =>
        this.replyWithAddressPromptWindow(params),
      replyWithAddressConfirmationWindow: (params) =>
        this.replyWithAddressConfirmationWindow(params),
      routeAddressCompleteness: (params) =>
        this.turnAddressCompletenessRuntime.routeAddressCompleteness(params),
      handleAddressExistingCandidate: (params) =>
        this.turnAddressExistingCandidateRuntime.handleAddressExistingCandidate(
          params,
        ),
      buildSideQuestionReply: (tenantId, transcript) =>
        this.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
    });
    this.turnSideQuestionRoutingRuntime =
      new VoiceTurnSideQuestionRoutingRuntime({
        replyWithSideQuestionAndContinue: (params) =>
          this.turnSideQuestionHelperRuntime.replyWithSideQuestionAndContinue(
            params,
          ),
        getVoiceIssueCandidate: (collectedData) =>
          this.getVoiceIssueCandidate(collectedData),
        clearIssuePromptAttempts: (callSid) =>
          this.clearIssuePromptAttempts(callSid),
        shouldDiscloseFees: (params) => this.shouldDiscloseFees(params),
        getTenantFeePolicySafe: (tenantId) =>
          this.getTenantFeePolicySafe(tenantId),
        buildSmsHandoffMessageForContext: (params) =>
          this.buildSmsHandoffMessageForContext({
            feePolicy: params.feePolicy as PrismaTenantFeePolicy | null,
            includeFees: params.includeFees,
            isEmergency: params.isEmergency,
            callerFirstName: params.callerFirstName,
          }),
        isUrgencyEmergency: (collectedData) =>
          this.isUrgencyEmergency(collectedData),
        getVoiceNameCandidate: (nameState) =>
          this.getVoiceNameCandidate(nameState),
        replyWithSmsHandoff: (params) => this.replyWithSmsHandoff(params),
        replyWithIssueCaptureRecovery: (params) =>
          this.replyWithIssueCaptureRecovery(params),
        replyWithTwiml: (res, twiml) => this.replyWithTwiml(res, twiml),
        buildSayGatherTwiml: (message) => this.buildSayGatherTwiml(message),
      });
    this.turnIssueRecoveryRuntime = new VoiceTurnIssueRecoveryRuntime({
      getVoiceIssueCandidate: (collectedData) =>
        this.getVoiceIssueCandidate(collectedData),
      normalizeIssueCandidate: (value) => this.normalizeIssueCandidate(value),
      buildFallbackIssueCandidate: (value) =>
        this.buildFallbackIssueCandidate(value),
      isLikelyIssueCandidate: (value) => this.isLikelyIssueCandidate(value),
      getIssuePromptAttempts: (callSid) =>
        this.issuePromptAttemptsByCall.get(callSid) ?? 0,
      setIssuePromptAttempts: (callSid, count) =>
        this.issuePromptAttemptsByCall.set(callSid, count),
      clearIssuePromptAttempts: (callSid) =>
        this.clearIssuePromptAttempts(callSid),
      isLikelyQuestion: (value) => this.isLikelyQuestion(value),
      updateVoiceIssueCandidate: (params) =>
        this.conversationsService.updateVoiceIssueCandidate(params),
      shouldDiscloseFees: (params) => this.shouldDiscloseFees(params),
      getTenantFeePolicySafe: (tenantId) =>
        this.getTenantFeePolicySafe(tenantId),
      buildSmsHandoffMessageForContext: (params) =>
        this.buildSmsHandoffMessageForContext({
          feePolicy: params.feePolicy as PrismaTenantFeePolicy | null,
          includeFees: params.includeFees,
          isEmergency: params.isEmergency,
          callerFirstName: params.callerFirstName,
        }),
      isUrgencyEmergency: (collectedData) =>
        this.isUrgencyEmergency(collectedData),
      getVoiceNameCandidate: (nameState) =>
        this.getVoiceNameCandidate(nameState),
      replyWithSmsHandoff: (params) => this.replyWithSmsHandoff(params),
      log: (payload, context) => this.loggingService.log(payload, context),
      buildSayGatherTwiml: (message) => this.buildSayGatherTwiml(message),
      applyCsrStrategy: (strategy, message) =>
        this.applyCsrStrategy(strategy, message),
      replyWithTwiml: (res, twiml) => this.replyWithTwiml(res, twiml),
      loggerContext: VoiceTurnService.name,
    });
    this.turnAiTriageRuntime = new VoiceTurnAiTriageRuntime({
      getVoiceIssueCandidate: (collectedData) =>
        this.getVoiceIssueCandidate(collectedData),
      clearIssuePromptAttempts: (callSid) =>
        this.clearIssuePromptAttempts(callSid),
      normalizeIssueCandidate: (value) => this.normalizeIssueCandidate(value),
      isLikelyIssueCandidate: (value) => this.isLikelyIssueCandidate(value),
      updateVoiceIssueCandidate: (params) =>
        this.conversationsService.updateVoiceIssueCandidate(params),
      replyWithIssueCaptureRecovery: (params) =>
        this.replyWithIssueCaptureRecovery(params),
      isIssueRepeatComplaint: (value) => this.isIssueRepeatComplaint(value),
      triage: (params) =>
        this.trackAiCall(params.timingCollector, () =>
          this.aiService.triage(
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
        this.buildSmsHandoffMessage(callerFirstName),
      shouldDiscloseFees: (params) => this.shouldDiscloseFees(params),
      getTenantFeePolicySafe: (tenantId) =>
        this.getTenantFeePolicySafe(tenantId),
      buildSmsHandoffMessageForContext: (params) =>
        this.buildSmsHandoffMessageForContext({
          feePolicy: params.feePolicy as PrismaTenantFeePolicy | null,
          includeFees: params.includeFees,
          isEmergency: params.isEmergency,
          callerFirstName: params.callerFirstName,
        }),
      isUrgencyEmergency: (collectedData) =>
        this.isUrgencyEmergency(collectedData),
      getVoiceNameCandidate: (nameState) =>
        this.getVoiceNameCandidate(nameState),
      replyWithSmsHandoff: (params) => this.replyWithSmsHandoff(params),
      normalizeConfirmationUtterance: (value) =>
        this.normalizeConfirmationUtterance(value),
      replyWithTwiml: (res, twiml) => this.replyWithTwiml(res, twiml),
      buildSayGatherTwiml: (message) => this.buildSayGatherTwiml(message),
      isHumanFallbackMessage: (message) => this.isHumanFallbackMessage(message),
      replyWithHumanFallback: (params) => this.replyWithHumanFallback(params),
      isLikelyQuestion: (transcript) => this.isLikelyQuestion(transcript),
      isBookingIntent: (transcript) => this.isBookingIntent(transcript),
      replyWithBookingOffer: (params) => this.replyWithBookingOffer(params),
      logVoiceOutcome: (params) => this.logVoiceOutcome(params),
      buildTwiml: (message) => this.buildTwiml(message),
      replyWithNoHandoff: (params) => this.replyWithNoHandoff(params),
      warn: (payload, context) => this.loggingService.warn(payload, context),
      loggerContext: VoiceTurnService.name,
    });
    this.turnSideQuestionRuntime = new VoiceTurnSideQuestionRuntime({
      resolveBinaryUtterance: (transcript) =>
        this.resolveBinaryUtterance(transcript),
      isFrustrationRequest: (transcript) =>
        this.isFrustrationRequest(transcript),
      clearVoiceListeningWindow: (params) =>
        this.clearVoiceListeningWindow(params),
      replyWithSideQuestionAndContinue: (params) =>
        this.turnSideQuestionHelperRuntime.replyWithSideQuestionAndContinue(
          params,
        ),
      getVoiceIssueCandidate: (collectedData) =>
        this.getVoiceIssueCandidate(collectedData),
      buildAskNameTwiml: (strategy) => this.buildAskNameTwiml(strategy),
      prependPrefaceToGatherTwiml: (preface, twiml) =>
        this.prependPrefaceToGatherTwiml(preface, twiml),
      replyWithListeningWindow: (params) =>
        this.replyWithListeningWindow(params),
      buildAddressPromptForState: (addressState, strategy) =>
        this.buildAddressPromptForState(addressState, strategy),
      replyWithIssueCaptureRecovery: (params) =>
        this.replyWithIssueCaptureRecovery(params),
      continueAfterSideQuestionWithIssueRouting: (params) =>
        this.continueAfterSideQuestionWithIssueRouting(params),
      buildSideQuestionReply: (tenantId, transcript) =>
        this.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
      updateVoiceUrgencyConfirmation: (params) =>
        this.conversationsService.updateVoiceUrgencyConfirmation(params),
      buildUrgencyConfirmTwiml: (strategy, context) =>
        this.buildUrgencyConfirmTwiml(strategy, context),
      getVoiceNameCandidate: (nameState) =>
        this.getVoiceNameCandidate(nameState),
    });
  }

  public async handleTurn(params: {
    res?: Response;
    tenant: TenantOrganization;
    callSid: string;
    speechResult?: string | null;
    confidence?: string | number | null;
    requestId?: string;
  }) {
    return this.processTurn({
      res: params.res,
      tenant: params.tenant,
      callSid: params.callSid,
      speechResult: params.speechResult ?? null,
      confidence: params.confidence ?? null,
      requestId: params.requestId,
    });
  }

  public async handleStreamingTurn(params: {
    tenant: TenantOrganization;
    callSid: string;
    speechResult?: string | null;
    confidence?: number;
    requestId?: string;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string> {
    return this.processTurn({
      res: undefined,
      tenant: params.tenant,
      callSid: params.callSid,
      speechResult: params.speechResult ?? null,
      confidence: params.confidence ?? null,
      requestId: params.requestId,
      timingCollector: params.timingCollector,
    });
  }

  private async processTurn(params: {
    res?: Response;
    tenant: TenantOrganization;
    callSid: string;
    speechResult?: string | null;
    confidence?: string | number | null;
    requestId?: string;
    timingCollector?: VoiceTurnTimingCollector;
  }) {
    const { tenant, callSid, res } = params;
    const timingCollector = params.timingCollector;
    const prelude = await this.turnPreludeRuntime.prepare({
      res,
      tenant,
      callSid,
      speechResult: params.speechResult ?? null,
      confidence: params.confidence ?? null,
    });
    if (prelude.kind === "exit") {
      return prelude.value;
    }
    const {
      now,
      normalizedSpeech,
      confidence,
      voiceTurnCount,
      displayName,
      currentEventId,
      conversation,
      updatedConversation,
      conversationId,
      collectedData,
    } = prelude;
    const requestId = params.requestId;
    setRequestContextData({
      tenantId: tenant.id,
      requestId,
      callSid,
      conversationId,
      channel: "VOICE",
      sourceEventId: currentEventId ?? undefined,
    });
    const turnContext = await this.turnContextRuntime.prepareTurnContext({
      res,
      tenantId: tenant.id,
      conversationId,
      currentEventId,
      voiceTurnCount,
      now,
      collectedData,
      conversationForStrategy: updatedConversation ?? conversation,
      conversationCurrentFsmState:
        updatedConversation?.currentFSMState ??
        conversation.currentFSMState ??
        null,
    });
    if (turnContext.kind === "exit") {
      return turnContext.value;
    }
    const {
      nameState: contextNameState,
      phoneState: contextPhoneState,
      addressState: contextAddressState,
      csrStrategy: contextStrategy,
      expectedField: contextExpectedField,
      nameReady: contextNameReady,
      addressReady: contextAddressReady,
    } = turnContext;
    let nameState = contextNameState;
    const phoneState = contextPhoneState;
    const addressState = contextAddressState;
    const csrStrategy = contextStrategy;
    let expectedField = contextExpectedField;
    let nameReady = contextNameReady;
    const addressReady = contextAddressReady;
    const earlyRouting = await this.turnEarlyRoutingRuntime.route({
      res,
      tenantId: tenant.id,
      conversationId,
      callSid,
      displayName,
      currentEventId,
      normalizedSpeech,
      expectedField,
      nameReady,
      addressReady,
      nameState,
      addressState,
      collectedData,
      strategy: csrStrategy,
      timingCollector,
    });
    if (earlyRouting.kind === "exit") {
      return earlyRouting.value;
    }
    expectedField = earlyRouting.expectedField;
    const slowDownBranch = await this.turnInterruptRuntime.handleSlowDown({
      res,
      tenantId: tenant.id,
      conversationId,
      currentEventId,
      normalizedSpeech,
      expectedField,
      strategy: csrStrategy,
    });
    if (slowDownBranch.kind === "exit") {
      return slowDownBranch.value;
    }

    const existingIssueCandidate = this.getVoiceIssueCandidate(collectedData);
    const issueCandidate = this.normalizeIssueCandidate(normalizedSpeech);
    const hasIssueCandidate = this.isLikelyIssueCandidate(issueCandidate);
    // Set by multi-slot opening capture below; used to personalize the first address ask.
    let openingAddressPreface: string | null = null;
    if (existingIssueCandidate?.value || hasIssueCandidate) {
      this.clearIssuePromptAttempts(callSid);
    }
    if (hasIssueCandidate && !existingIssueCandidate?.value) {
      await this.conversationsService.updateVoiceIssueCandidate({
        tenantId: tenant.id,
        conversationId,
        issue: {
          value: issueCandidate,
          sourceEventId: currentEventId ?? "",
          createdAt: new Date().toISOString(),
        },
      });
    }
    const shouldCaptureOpeningNameFromMultiSlot =
      !expectedField &&
      !nameReady &&
      hasIssueCandidate &&
      nameState.status === "MISSING" &&
      nameState.attemptCount === 0 &&
      !nameState.candidate.value;
    if (shouldCaptureOpeningNameFromMultiSlot) {
      const deterministicNameCandidate = extractNameCandidateDeterministic(
        normalizedSpeech,
        this.sanitizationService,
      );
      const hasDeterministicName =
        deterministicNameCandidate &&
        isValidNameCandidate(deterministicNameCandidate) &&
        isLikelyNameCandidate(deterministicNameCandidate);
      if (hasDeterministicName && deterministicNameCandidate) {
        const currentName =
          nameState.candidate.value?.trim().toLowerCase() ?? "";
        const incomingName = deterministicNameCandidate.trim().toLowerCase();
        if (currentName !== incomingName || !nameState.locked) {
          const nextNameState: typeof nameState = {
            ...nameState,
            candidate: {
              value: deterministicNameCandidate,
              sourceEventId: currentEventId ?? null,
              createdAt: new Date().toISOString(),
            },
            status: "CANDIDATE",
            locked: true,
            attemptCount: Math.max(1, nameState.attemptCount),
            lastConfidence:
              typeof confidence === "number"
                ? confidence
                : (nameState.lastConfidence ?? null),
            spellPromptedAt: null,
            spellPromptedTurnIndex: null,
          };
          await this.conversationsService.updateVoiceNameState({
            tenantId: tenant.id,
            conversationId,
            nameState: nextNameState,
          });
          this.loggingService.log(
            {
              event: "voice.name_multislot_captured",
              tenantId: tenant.id,
              conversationId,
              callSid,
              candidate: deterministicNameCandidate,
              sourceEventId: currentEventId,
            },
            VoiceTurnService.name,
          );
          nameState = nextNameState;
        }
        nameReady = true;
        // Build a personalized preface for the upcoming address ask so the caller
        // hears "Thanks, David. I heard furnace issue." rather than "Thanks for calling."
        const _msFirstName =
          deterministicNameCandidate.split(" ").filter(Boolean)[0] ?? "";
        const _msIssueAck = hasIssueCandidate
          ? this.buildIssueAcknowledgement(issueCandidate)
          : null;
        const _msTrimmedIssue =
          _msIssueAck?.trim().replace(/[.?!]+$/, "") ?? "";
        openingAddressPreface = _msFirstName
          ? _msTrimmedIssue
            ? `Thanks, ${_msFirstName}. I heard ${_msTrimmedIssue}.`
            : `Thanks, ${_msFirstName}.`
          : null;
      }
    }
    if (
      !nameReady &&
      !expectedField &&
      this.isLikelyAddressInputForName(normalizedSpeech)
    ) {
      expectedField = "address";
    }
    const yesNoIntent = this.resolveBinaryUtterance(normalizedSpeech);
    if (
      !expectedField &&
      !addressReady &&
      Boolean(addressState.candidate) &&
      (Boolean(yesNoIntent) ||
        /\d/.test(normalizedSpeech) ||
        Boolean(
          voiceAddressCandidatePolicy.extractAddressLocalityCorrection(
            normalizedSpeech,
            this.sanitizationService,
          ),
        ))
    ) {
      expectedField = "address";
    }
    const urgencyConfirmation =
      this.conversationsService.getVoiceUrgencyConfirmation(collectedData);
    const emergencyIssueContext =
      existingIssueCandidate?.value ??
      (hasIssueCandidate ? issueCandidate : "");
    const emergencyRelevant = this.isComfortRiskRelevant(
      existingIssueCandidate?.value ??
        (hasIssueCandidate ? issueCandidate : ""),
    );
    const isQuestionUtterance = this.isLikelyQuestion(normalizedSpeech);
    const turnPlan = reduceVoiceTurnPlanner(
      {
        expectedField,
        nameReady,
        addressReady,
        issueCaptured: Boolean(
          existingIssueCandidate?.value || hasIssueCandidate,
        ),
        emergencyRelevant,
        emergencyAsked: Boolean(urgencyConfirmation.askedAt),
        emergencyAnswered: Boolean(urgencyConfirmation.response),
      },
      {
        isQuestion: isQuestionUtterance,
      },
    );
    const shouldAskUrgencyConfirm = turnPlan.type === "ASK_EMERGENCY";

    const interruptBranch = await this.turnInterruptRuntime.handleInterrupts({
      res,
      tenantId: tenant.id,
      conversationId,
      callSid,
      currentEventId,
      normalizedSpeech,
      strategy: csrStrategy,
      phoneState,
    });
    if (interruptBranch.kind === "exit") {
      return interruptBranch.value;
    }

    const sideQuestionBranch = await this.turnSideQuestionRuntime.handle({
      res,
      tenantId: tenant.id,
      conversationId,
      callSid,
      displayName,
      normalizedSpeech,
      expectedField,
      nameReady,
      addressReady,
      nameState,
      addressState,
      collectedData,
      currentEventId,
      strategy: csrStrategy,
      timingCollector,
      shouldAskUrgencyConfirm,
      urgencyConfirmation,
      emergencyIssueContext,
    });
    if (sideQuestionBranch.kind === "exit") {
      return sideQuestionBranch.value;
    }
    // Name flow map (current):
    // - Yes/no prompts: buildNameConfirmationTwiml/buildNameSoftConfirmationTwiml/buildYesNoRepromptTwiml.
    // - Confirmation parsing: resolveConfirmation + extractReplacementCandidate.
    // - Progression gate: nameReady (locked/confirmed) before moving to address.
    // - Listening window gate: voiceListeningWindow field "confirmation" with targetField "name".
    if (!nameReady && (!expectedField || expectedField === "name")) {
      const existingIssueSummary = existingIssueCandidate?.value
        ? this.buildIssueAcknowledgement(existingIssueCandidate.value)
        : null;
      const bookingIntent = this.isBookingIntent(normalizedSpeech);
      const isOpeningTurn =
        !expectedField &&
        nameState.status === "MISSING" &&
        nameState.attemptCount === 0 &&
        !nameState.candidate.value &&
        !existingIssueCandidate?.value;
      const turnIndex = voiceTurnCount;
      const nameFlowSession = this.turnNameFlowRuntime.createSession({
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        currentEventId,
        strategy: csrStrategy,
        turnIndex,
        nameState,
        existingIssueSummary,
        buildSpellNameTwiml: () => this.buildSpellNameTwiml(csrStrategy),
      });
      const spellingResponse = await this.turnNameSpellingRuntime.handle({
        normalizedSpeech,
        nameState: nameFlowSession.getNameState(),
        confidence,
        turnIndex,
        tenantId: tenant.id,
        conversationId,
        callSid,
        storeProvisionalName: nameFlowSession.storeProvisionalName,
        acknowledgeNameAndMoveOn: nameFlowSession.acknowledgeNameAndMoveOn,
        replyWithNameTwiml: nameFlowSession.replyWithNameTwiml,
        replyWithAddressPrompt: () => nameFlowSession.replyWithAddressPrompt(),
        buildSpellNameTwiml: () => this.buildSpellNameTwiml(csrStrategy),
      });
      if (spellingResponse) {
        return spellingResponse;
      }

      const openingTurnReply = await this.turnNameOpeningRuntime.handle({
        isOpeningTurn,
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        currentEventId,
        normalizedSpeech,
        bookingIntent,
        nameState,
        confidence,
        strategy: csrStrategy,
        storeProvisionalName: nameFlowSession.storeProvisionalName,
        maybePromptForSpelling: nameFlowSession.maybePromptForSpelling,
        replyWithNameTwiml: nameFlowSession.replyWithNameTwiml,
      });
      if (openingTurnReply) {
        return openingTurnReply;
      }

      return this.turnNameCaptureRuntime.handle({
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        currentEventId,
        normalizedSpeech,
        expectedField,
        bookingIntent,
        nameState,
        collectedData,
        confidence,
        strategy: csrStrategy,
        timingCollector,
        recordNameAttemptIfNeeded: nameFlowSession.recordNameAttemptIfNeeded,
        replyWithAddressPrompt: nameFlowSession.replyWithAddressPrompt,
        replyWithNameTwiml: nameFlowSession.replyWithNameTwiml,
        storeProvisionalName: nameFlowSession.storeProvisionalName,
        promptForNameSpelling: nameFlowSession.promptForNameSpelling,
        maybePromptForSpelling: nameFlowSession.maybePromptForSpelling,
        acknowledgeNameAndMoveOn: nameFlowSession.acknowledgeNameAndMoveOn,
      });
    }

    const expectedFieldBranch =
      await this.turnExpectedFieldRuntime.handleSmsPhoneExpectedField({
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        displayName,
        expectedField,
        phoneState,
        collectedData,
        normalizedSpeech,
        currentEventId,
        strategy: csrStrategy,
      });
    if (expectedFieldBranch.kind === "exit") {
      return expectedFieldBranch.value;
    }
    expectedField = expectedFieldBranch.expectedField;

    if (expectedField === "address" && addressReady) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      expectedField = null;
    }
    if (!addressReady && (!expectedField || expectedField === "address")) {
      const addressPreRoutingResponse =
        await this.turnAddressRoutingRuntime.handleNotReady({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          currentEventId,
          normalizedSpeech,
          confidence,
          addressState,
          nameState,
          nameReady,
          collectedData,
          expectedField,
          openingAddressPreface,
          strategy: csrStrategy,
          timingCollector,
        });
      if (addressPreRoutingResponse) {
        return addressPreRoutingResponse;
      }

      return this.turnAddressExtractionRuntime.handle({
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        displayName,
        currentEventId,
        normalizedSpeech,
        addressState,
        nameState,
        collectedData,
        strategy: csrStrategy,
        timingCollector,
      });
    }

    if (
      addressState.locked &&
      addressState.sourceEventId &&
      addressState.sourceEventId === currentEventId
    ) {
      return this.turnAddressConfirmedRuntime.handleAddressConfirmedContinuation(
        {
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          currentEventId,
          addressState,
          nameState,
          nameReady,
          collectedData,
          strategy: csrStrategy,
          timingCollector,
        },
      );
    }

    return this.turnAiTriageRuntime.handle({
      res,
      tenantId: tenant.id,
      conversationId,
      callSid,
      displayName,
      normalizedSpeech,
      currentEventId,
      nameReady,
      addressReady,
      nameState,
      addressState,
      collectedData,
      strategy: csrStrategy,
      timingCollector,
      shouldPromptForIssue: turnPlan.type === "ASK_ISSUE",
    });
  }

  public async replyWithTwiml(
    res: Response | undefined,
    twiml: string,
  ): Promise<string> {
    if (!this.shouldSuppressDuplicateResponse(twiml)) {
      await this.logVoiceAssistantMessages(twiml);
    }
    if (res) {
      res.status(200).type("text/xml").send(twiml);
    }
    return twiml;
  }

  public disabledTwiml(): string {
    return this.voicePromptComposer.disabledTwiml();
  }

  private unroutableTwiml(): string {
    return this.voicePromptComposer.unroutableTwiml();
  }

  public buildConsentMessage(displayName: string): string {
    return this.voicePromptComposer.buildConsentMessage(displayName);
  }

  public buildConsentTwiml(displayName: string): string {
    return this.voicePromptComposer.buildConsentTwiml(displayName);
  }

  private buildSayGatherTwiml(
    message: string,
    options?: { timeout?: number; bargeIn?: boolean },
  ): string {
    return this.voicePromptComposer.buildSayGatherTwiml(message, options);
  }

  private buildRepromptTwiml(strategy?: CsrStrategy): string {
    return this.voicePromptComposer.buildRepromptTwiml(strategy);
  }

  private buildNameConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    return this.voicePromptComposer.buildNameConfirmationTwiml(
      candidate,
      strategy,
    );
  }

  private buildNameSoftConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    return this.voicePromptComposer.buildNameSoftConfirmationTwiml(
      candidate,
      strategy,
    );
  }

  private buildAskNameTwiml(strategy?: CsrStrategy): string {
    return this.voicePromptComposer.buildAskNameTwiml(strategy);
  }

  private buildSpellNameTwiml(strategy?: CsrStrategy): string {
    return this.voicePromptComposer.buildSpellNameTwiml(strategy);
  }

  private buildAskSmsNumberTwiml(strategy?: CsrStrategy): string {
    return this.voicePromptComposer.buildAskSmsNumberTwiml(strategy);
  }

  private buildTakeYourTimeTwiml(
    field: "name" | "address" | "sms_phone",
    strategy?: CsrStrategy,
  ): string {
    return this.voicePromptComposer.buildTakeYourTimeTwiml(field, strategy);
  }

  private buildBookingPromptTwiml(strategy?: CsrStrategy): string {
    return this.voicePromptComposer.buildBookingPromptTwiml(strategy);
  }

  private buildCallbackOfferTwiml(strategy?: CsrStrategy): string {
    return this.voicePromptComposer.buildCallbackOfferTwiml(strategy);
  }

  private buildComfortRiskTwiml(
    strategy?: CsrStrategy,
    context?: {
      callerName?: string | null;
      issueCandidate?: string | null;
    },
  ): string {
    return this.voicePromptComposer.buildComfortRiskTwiml(strategy, {
      callerName: context?.callerName,
      issueSummary: context?.issueCandidate
        ? this.buildIssueAcknowledgement(context.issueCandidate)
        : null,
    });
  }

  private buildUrgencyConfirmTwiml(
    strategy?: CsrStrategy,
    context?: {
      callerName?: string | null;
      issueCandidate?: string | null;
    },
  ): string {
    return this.voicePromptComposer.buildUrgencyConfirmTwiml(strategy, {
      callerName: context?.callerName,
      issueSummary: context?.issueCandidate
        ? this.buildIssueAcknowledgement(context.issueCandidate)
        : null,
    });
  }

  private buildAddressConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    return this.voicePromptComposer.buildAddressConfirmationTwiml(
      candidate,
      strategy,
    );
  }

  private buildAddressSoftConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    return this.voicePromptComposer.buildAddressSoftConfirmationTwiml(
      candidate,
      strategy,
    );
  }

  private buildAddressLocalityPromptTwiml(strategy?: CsrStrategy): string {
    return this.voicePromptComposer.buildAddressLocalityPromptTwiml(strategy);
  }

  private buildAskAddressTwiml(strategy?: CsrStrategy): string {
    return this.voicePromptComposer.buildAskAddressTwiml(strategy);
  }

  private buildIncompleteAddressTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    return this.voicePromptComposer.buildIncompleteAddressTwiml(
      candidate,
      strategy,
    );
  }

  private buildYesNoRepromptTwiml(strategy?: CsrStrategy): string {
    return this.voicePromptComposer.buildYesNoRepromptTwiml(strategy);
  }

  private buildSmsHandoffMessage(callerFirstName?: string): string {
    return this.voiceHandoffPolicy.buildSmsHandoffMessage(callerFirstName);
  }

  private buildSmsHandoffMessageWithFees(params: {
    feePolicy: PrismaTenantFeePolicy | null;
    isEmergency: boolean;
    callerFirstName?: string;
  }): string {
    return this.voiceHandoffPolicy.buildSmsHandoffMessageWithFees(params);
  }

  private buildSmsHandoffMessageForContext(params: {
    feePolicy: PrismaTenantFeePolicy | null;
    includeFees: boolean;
    isEmergency: boolean;
    callerFirstName?: string;
  }): string {
    return this.voiceHandoffPolicy.buildSmsHandoffMessageForContext(params);
  }

  private async resolveSmsHandoffClosingMessage(params: {
    tenantId: string;
    collectedData: unknown;
    messageOverride?: string;
    callerFirstName?: string;
  }): Promise<string> {
    return this.voiceHandoffPolicy.resolveSmsHandoffClosingMessage({
      tenantId: params.tenantId,
      isEmergency: this.isUrgencyEmergency(params.collectedData),
      messageOverride: params.messageOverride,
      callerFirstName: params.callerFirstName,
    });
  }

  private buildClosingTwiml(displayName: string, message: string): string {
    return this.voicePromptComposer.buildClosingTwiml(displayName, message);
  }

  private isHumanFallbackMessage(message: string): boolean {
    return (
      message.trim() === "Thanks. We'll follow up shortly." ||
      message.trim() === "We'll follow up shortly."
    );
  }

  private logVoiceOutcome(params: {
    outcome: "sms_handoff" | "human_fallback" | "no_handoff";
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    reason: string;
  }) {
    this.loggingService.log(
      {
        event: "voice.outcome",
        outcome: params.outcome,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        reason: params.reason,
      },
      VoiceTurnService.name,
    );
  }

  private async replyWithSmsHandoff(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    reason: string;
    messageOverride?: string;
  }) {
    this.clearIssuePromptAttempts(params.callSid);
    const handoffPreparation = await this.voiceSmsHandoffService.prepare({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
      messageOverride: params.messageOverride,
      loggerContext: VoiceTurnService.name,
    });
    if (handoffPreparation.kind === "prompt_confirm_ani") {
      const lastFour = handoffPreparation.fallbackPhone
        .replace(/\D/g, "")
        .slice(-4);
      return this.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "sms_phone",
        sourceEventId: handoffPreparation.sourceEventId,
        twiml: this.buildSayGatherTwiml(
          `I'll send your confirmation to the number ending in ${lastFour}. Does that work, or would you prefer a different number?`,
        ),
      });
    }
    if (handoffPreparation.kind === "prompt_ask_sms_phone") {
      return this.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "sms_phone",
        sourceEventId: handoffPreparation.sourceEventId,
        twiml: this.buildAskSmsNumberTwiml(),
      });
    }
    this.logVoiceOutcome({
      outcome: "sms_handoff",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });
    if (handoffPreparation.resolvedSmsPhone) {
      try {
        await this.paymentsService.sendVoiceHandoffIntakeLink({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          toPhone: handoffPreparation.resolvedSmsPhone,
          displayName: params.displayName,
          isEmergency: this.isUrgencyEmergency(
            handoffPreparation.collectedData,
          ),
        });
      } catch (error) {
        this.loggingService.warn(
          {
            event: "voice.sms_intake_link_send_failed",
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            callSid: params.callSid,
            reason: error instanceof Error ? error.message : String(error),
          },
          VoiceTurnService.name,
        );
      }
    }
    const closingMessage = await this.resolveSmsHandoffClosingMessage({
      tenantId: params.tenantId,
      collectedData: handoffPreparation.collectedData,
      messageOverride: params.messageOverride,
    });
    return this.replyWithTwiml(
      params.res,
      this.buildClosingTwiml(params.displayName, closingMessage),
    );
  }

  public async replyWithHumanFallback(params: {
    res?: Response;
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    displayName?: string;
    reason: string;
    messageOverride?: string;
  }) {
    this.logVoiceOutcome({
      outcome: "human_fallback",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });
    this.clearIssuePromptAttempts(params.callSid);
    const message = params.messageOverride ?? "We'll follow up shortly.";
    return this.replyWithTwiml(
      params.res,
      this.buildClosingTwiml(params.displayName ?? "", message),
    );
  }

  public async replyWithNoHandoff(params: {
    res?: Response;
    reason: string;
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    twimlOverride?: string;
  }) {
    this.logVoiceOutcome({
      outcome: "no_handoff",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });
    this.clearIssuePromptAttempts(params.callSid);
    return this.replyWithTwiml(
      params.res,
      params.twimlOverride ?? this.unroutableTwiml(),
    );
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
    await this.conversationsService.updateVoiceAddressState({
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
    return this.replyWithListeningWindow({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      field: "address",
      sourceEventId: params.currentEventId,
      twiml: this.buildAddressLocalityPromptTwiml(params.strategy),
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
    await this.conversationsService.updateVoiceAddressState({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      addressState: nextAddressState,
    });
    this.loggingService.log(
      {
        event: "voice.address_deferred_to_sms",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        attemptCount: nextAddressState.attemptCount,
        candidate: nextAddressState.candidate,
        confidence: nextAddressState.confidence,
      },
      VoiceTurnService.name,
    );
    await this.clearVoiceListeningWindow({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });

    const issueCandidate = this.getVoiceIssueCandidate(params.collectedData);
    if (issueCandidate?.value) {
      const includeFees = this.shouldDiscloseFees({
        nameState: params.nameState,
        addressState: nextAddressState,
        collectedData: params.collectedData,
      });
      const feePolicy = includeFees
        ? await this.getTenantFeePolicySafe(params.tenantId)
        : null;
      const smsMessage = this.buildSmsHandoffMessageForContext({
        feePolicy,
        includeFees,
        isEmergency: this.isUrgencyEmergency(params.collectedData),
        callerFirstName: this.getVoiceNameCandidate(params.nameState)
          ?.split(" ")
          .filter(Boolean)[0],
      });
      return this.replyWithSmsHandoff({
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
    return this.replyWithTwiml(
      params.res,
      this.buildSayGatherTwiml(this.applyCsrStrategy(params.strategy, message)),
    );
  }

  private getVoiceIssueCandidate(
    collectedData: unknown,
  ): { value?: string; sourceEventId?: string } | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const record = collectedData as Record<string, unknown>;
    const candidate = record.issueCandidate as
      | { value?: string; sourceEventId?: string }
      | undefined;
    if (!candidate?.value) {
      return null;
    }
    return candidate;
  }

  private getVoiceNameCandidate(
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>,
  ): string | null {
    return nameState.confirmed.value ?? nameState.candidate.value ?? null;
  }

  private getVoiceComfortRisk(collectedData: unknown): VoiceComfortRisk {
    if (!collectedData || typeof collectedData !== "object") {
      return { askedAt: null, response: null, sourceEventId: null };
    }
    const data = collectedData as Record<string, unknown>;
    const raw = data.voiceComfortRisk;
    if (!raw || typeof raw !== "object") {
      return { askedAt: null, response: null, sourceEventId: null };
    }
    const record = raw as Partial<VoiceComfortRisk>;
    const response =
      record.response === "YES" || record.response === "NO"
        ? record.response
        : null;
    return {
      askedAt: typeof record.askedAt === "string" ? record.askedAt : null,
      response,
      sourceEventId:
        typeof record.sourceEventId === "string" ? record.sourceEventId : null,
    };
  }

  private getVoiceUrgencyConfirmation(
    collectedData: unknown,
  ): VoiceUrgencyConfirmation {
    if (!collectedData || typeof collectedData !== "object") {
      return { askedAt: null, response: null, sourceEventId: null };
    }
    const data = collectedData as Record<string, unknown>;
    const raw = data.voiceUrgencyConfirmation;
    if (!raw || typeof raw !== "object") {
      return { askedAt: null, response: null, sourceEventId: null };
    }
    const record = raw as Partial<VoiceUrgencyConfirmation>;
    const response =
      record.response === "YES" || record.response === "NO"
        ? record.response
        : null;
    return {
      askedAt: typeof record.askedAt === "string" ? record.askedAt : null,
      response,
      sourceEventId:
        typeof record.sourceEventId === "string" ? record.sourceEventId : null,
    };
  }

  private normalizeIssueCandidate(value: string): string {
    return normalizeVoiceIssueCandidate(value, {
      sanitizeText: (input) => this.sanitizationService.sanitizeText(input),
      normalizeWhitespace: (input) =>
        this.sanitizationService.normalizeWhitespace(input),
    });
  }

  private buildFallbackIssueCandidate(value: string): string | null {
    return buildVoiceFallbackIssueCandidate(value, {
      normalizeIssueCandidate: (input) => this.normalizeIssueCandidate(input),
      isLikelyQuestion: (input) => this.isLikelyQuestion(input),
      resolveBinaryUtterance: (input) => this.resolveBinaryUtterance(input),
    });
  }

  private isComfortRiskRelevant(value: string): boolean {
    return isVoiceComfortRiskRelevant(value, (input) =>
      this.normalizeIssueCandidate(input),
    );
  }

  private buildIssueAcknowledgement(value: string): string | null {
    return buildVoiceIssueAcknowledgement(value, {
      normalizeIssueCandidate: (input) => this.normalizeIssueCandidate(input),
      normalizeWhitespace: (input) =>
        this.sanitizationService.normalizeWhitespace(input),
    });
  }

  private isLikelyIssueCandidate(value: string): boolean {
    return isLikelyVoiceIssueCandidate(value, (input) =>
      this.normalizeIssueCandidate(input),
    );
  }

  private isIssueRepeatComplaint(value: string): boolean {
    return isVoiceIssueRepeatComplaint(value);
  }

  private shouldDiscloseFees(params: {
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    collectedData: unknown;
    currentSpeech?: string;
  }): boolean {
    const nameReady =
      Boolean(params.nameState.confirmed.value) ||
      this.isVoiceFieldReady(
        params.nameState.locked,
        params.nameState.confirmed.value,
      );
    const addressReady =
      Boolean(params.addressState.confirmed) ||
      this.isVoiceFieldReady(
        params.addressState.locked,
        params.addressState.confirmed,
      ) ||
      Boolean(params.addressState.smsConfirmNeeded);
    if (!nameReady || !addressReady) {
      return false;
    }
    const existingIssue = this.getVoiceIssueCandidate(params.collectedData);
    if (existingIssue?.value) {
      return true;
    }
    if (!params.currentSpeech) {
      return false;
    }
    const normalizedIssue = this.normalizeIssueCandidate(params.currentSpeech);
    return this.isLikelyIssueCandidate(normalizedIssue);
  }

  private selectCsrStrategy(params: {
    conversation: { currentFSMState?: string | null };
    collectedData: unknown;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
  }): CsrStrategy {
    const hasConfirmedName =
      Boolean(params.nameState.confirmed.value) ||
      this.isVoiceFieldReady(
        params.nameState.locked,
        params.nameState.confirmed.value,
      );
    const hasConfirmedAddress =
      Boolean(params.addressState.confirmed) ||
      this.isVoiceFieldReady(
        params.addressState.locked,
        params.addressState.confirmed,
      ) ||
      Boolean(params.addressState.smsConfirmNeeded);
    return this.csrStrategySelector.selectStrategy({
      channel: CommunicationChannel.VOICE,
      fsmState: params.conversation.currentFSMState ?? null,
      hasConfirmedName,
      hasConfirmedAddress,
      urgency: this.isUrgencyEmergency(params.collectedData),
      isPaymentRequiredNext: this.isPaymentRequiredNext(params.collectedData),
    });
  }

  public getTenantDisplayName(tenant: TenantOrganization): string {
    if (tenant.settings && typeof tenant.settings === "object") {
      const settings = tenant.settings as Record<string, unknown>;
      const displayName = settings.displayName;
      if (typeof displayName === "string" && displayName.trim()) {
        return displayName.trim();
      }
    }
    return tenant.name;
  }

  private async getTenantFeePolicySafe(
    tenantId: string,
  ): Promise<PrismaTenantFeePolicy | null> {
    return this.voiceHandoffPolicy.getTenantFeePolicySafe(tenantId);
  }

  private getTenantFeeConfig(policy: PrismaTenantFeePolicy | null): {
    serviceFee: number | null;
    emergencyFee: number | null;
    creditWindowHours: number;
  } {
    return this.voiceHandoffPolicy.getTenantFeeConfig(policy);
  }

  private formatFeeAmount(value: number): string {
    return this.voiceHandoffPolicy.formatFeeAmount(value);
  }

  private isUrgencyEmergency(collectedData: unknown): boolean {
    if (!collectedData || typeof collectedData !== "object") {
      return false;
    }
    const data = collectedData as Record<string, unknown>;
    const urgencyConfirmation = this.getVoiceUrgencyConfirmation(data);
    if (urgencyConfirmation.response === "YES") {
      return true;
    }
    const urgencyConfirmed =
      typeof data.urgencyConfirmed === "boolean"
        ? data.urgencyConfirmed
        : false;
    if (!urgencyConfirmed) {
      return false;
    }
    const urgency = data.urgency;
    if (typeof urgency === "string") {
      const normalized = urgency.trim().toUpperCase();
      return normalized === "EMERGENCY" || normalized === "URGENT";
    }
    return typeof urgency === "boolean" ? urgency : false;
  }

  private isPaymentRequiredNext(collectedData: unknown): boolean {
    if (!collectedData || typeof collectedData !== "object") {
      return false;
    }
    const data = collectedData as Record<string, unknown>;
    return Boolean(data.paymentRequired);
  }

  private applyCsrStrategy(
    strategy: CsrStrategy | undefined,
    message: string,
  ): string {
    return this.voicePromptComposer.applyCsrStrategy(strategy, message);
  }

  private async logVoiceAssistantMessages(twiml: string) {
    const context = getRequestContext();
    if (
      !context ||
      context.channel !== "VOICE" ||
      !context.tenantId ||
      !context.conversationId ||
      !context.callSid
    ) {
      return;
    }
    const messages = this.extractSayMessages(twiml);
    if (!messages.length) {
      return;
    }
    const baseSourceEventId = context.sourceEventId ?? undefined;
    await Promise.all(
      messages.map((message, index) =>
        this.callLogService.createVoiceAssistantLog({
          tenantId: context.tenantId as string,
          conversationId: context.conversationId as string,
          callSid: context.callSid as string,
          message,
          occurredAt: new Date(),
          sourceEventId: baseSourceEventId
            ? `${baseSourceEventId}:${index}`
            : undefined,
        }),
      ),
    );
  }

  private shouldSuppressDuplicateResponse(twiml: string): boolean {
    const context = getRequestContext();
    if (!context || context.channel !== "VOICE" || !context.callSid) {
      return false;
    }
    const callSid = context.callSid;
    const now = Date.now();
    const last = this.lastResponseByCall.get(callSid);
    if (last && last.twiml === twiml && now - last.at < 2000) {
      return true;
    }
    this.lastResponseByCall.set(callSid, { twiml, at: now });
    return false;
  }

  private extractSayMessages(twiml: string): string[] {
    return this.voicePromptComposer.extractSayMessages(twiml);
  }

  private extractGatherOptions(twiml: string): {
    timeout?: number;
    bargeIn?: boolean;
  } {
    return this.voicePromptComposer.extractGatherOptions(twiml);
  }

  private combineSideQuestionReply(preface: string, message: string): string {
    return this.voicePromptComposer.combineSideQuestionReply(preface, message);
  }

  private prependPrefaceToGatherTwiml(
    preface: string,
    baseTwiml: string,
  ): string {
    return this.voicePromptComposer.prependPrefaceToGatherTwiml(
      preface,
      baseTwiml,
    );
  }

  private withPrefix(prefix: string | undefined, message: string): string {
    return this.voicePromptComposer.withPrefix(prefix, message);
  }

  private isVoiceFieldReady(
    locked: boolean,
    confirmed: string | null,
  ): boolean {
    return locked && confirmed === null;
  }

  private getVoiceListeningWindow(
    collectedData: unknown,
  ): VoiceListeningWindow | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const data = collectedData as Record<string, unknown>;
    const raw = data.voiceListeningWindow;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const window = raw as Record<string, unknown>;
    const field = window.field;
    if (
      field !== "name" &&
      field !== "address" &&
      field !== "confirmation" &&
      field !== "sms_phone" &&
      field !== "comfort_risk" &&
      field !== "urgency_confirm"
    ) {
      return null;
    }
    const expiresAt =
      typeof window.expiresAt === "string" ? window.expiresAt : null;
    if (!expiresAt) {
      return null;
    }
    const targetField =
      window.targetField === "name" ||
      window.targetField === "address" ||
      window.targetField === "booking" ||
      window.targetField === "callback" ||
      window.targetField === "comfort_risk" ||
      window.targetField === "urgency_confirm"
        ? window.targetField
        : undefined;
    return {
      field,
      sourceEventId:
        typeof window.sourceEventId === "string" ? window.sourceEventId : null,
      expiresAt,
      ...(targetField ? { targetField } : {}),
    };
  }

  private getVoiceLastEventId(collectedData: unknown): string | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const data = collectedData as Record<string, unknown>;
    return typeof data.voiceLastEventId === "string"
      ? data.voiceLastEventId
      : null;
  }

  private isListeningWindowExpired(
    window: VoiceListeningWindow,
    now: Date,
  ): boolean {
    return isVoiceListeningWindowExpired(window, now);
  }

  private getExpectedListeningField(
    window: VoiceListeningWindow | null,
  ): VoiceExpectedField | null {
    return getExpectedVoiceListeningField(window);
  }

  private shouldClearListeningWindow(
    window: VoiceListeningWindow,
    now: Date,
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>,
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>,
    phoneState: ReturnType<ConversationsService["getVoiceSmsPhoneState"]>,
  ): boolean {
    return shouldClearVoiceListeningWindow({
      window,
      now,
      nameState,
      addressState,
      phoneState,
    });
  }

  private buildListeningWindowReprompt(params: {
    window: VoiceListeningWindow | null;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    phoneState: ReturnType<ConversationsService["getVoiceSmsPhoneState"]>;
    strategy?: CsrStrategy;
  }): string {
    return buildVoiceListeningWindowReprompt({
      window: params.window,
      addressState: params.addressState,
      strategy: params.strategy,
      buildAskNameTwiml: (strategy) =>
        this.buildAskNameTwiml(strategy as CsrStrategy | undefined),
      buildAddressPromptForState: (addressState, strategy) =>
        this.buildAddressPromptForState(
          addressState,
          strategy as CsrStrategy | undefined,
        ),
      buildAskSmsNumberTwiml: (strategy) =>
        this.buildAskSmsNumberTwiml(strategy as CsrStrategy | undefined),
      buildBookingPromptTwiml: (strategy) =>
        this.buildBookingPromptTwiml(strategy as CsrStrategy | undefined),
      buildCallbackOfferTwiml: (strategy) =>
        this.buildCallbackOfferTwiml(strategy as CsrStrategy | undefined),
      buildUrgencyConfirmTwiml: (strategy) =>
        this.buildUrgencyConfirmTwiml(strategy as CsrStrategy | undefined),
      buildRepromptTwiml: (strategy) =>
        this.buildRepromptTwiml(strategy as CsrStrategy | undefined),
    });
  }

  private async replyWithListeningWindow(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    field: VoiceListeningField;
    sourceEventId: string | null;
    twiml: string;
    timeoutSec?: number;
    targetField?:
      | "name"
      | "address"
      | "booking"
      | "callback"
      | "comfort_risk"
      | "urgency_confirm";
  }) {
    const timeoutSec =
      params.timeoutSec ??
      (params.field === "address" || params.targetField === "address"
        ? 24
        : params.field === "sms_phone"
          ? 20
          : 8);
    const expiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();
    await this.conversationsService.updateVoiceListeningWindow?.({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      window: {
        field: params.field,
        sourceEventId: params.sourceEventId,
        expiresAt,
        ...(params.targetField ? { targetField: params.targetField } : {}),
      },
    });
    return this.replyWithTwiml(params.res, params.twiml);
  }

  private async clearVoiceListeningWindow(params: {
    tenantId: string;
    conversationId: string;
  }) {
    await this.conversationsService.clearVoiceListeningWindow?.(params);
  }

  private async routeAddressCompleteness(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    currentEventId: string | null;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    candidateForCompleteness: string | null;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    collectedData: Prisma.JsonValue | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string | null> {
    return this.turnAddressCompletenessRuntime.routeAddressCompleteness({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      displayName: params.displayName,
      currentEventId: params.currentEventId,
      addressState: params.addressState,
      candidateForCompleteness: params.candidateForCompleteness,
      nameState: params.nameState,
      collectedData: params.collectedData,
      strategy: params.strategy,
      timingCollector: params.timingCollector,
    });
  }

  private async handleAddressExistingCandidate(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    currentEventId: string | null;
    normalizedSpeech: string;
    confidence: number | null | undefined;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    nameReady: boolean;
    collectedData: Prisma.JsonValue | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string | null> {
    return this.turnAddressExistingCandidateRuntime.handleAddressExistingCandidate(
      {
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        currentEventId: params.currentEventId,
        normalizedSpeech: params.normalizedSpeech,
        confidence: params.confidence,
        addressState: params.addressState,
        nameState: params.nameState,
        nameReady: params.nameReady,
        collectedData: params.collectedData,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      },
    );
  }

  private async replyWithAddressPromptWindow(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    strategy?: CsrStrategy;
  }): Promise<string> {
    return this.replyWithListeningWindow({
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
    return this.replyWithListeningWindow({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      field: "confirmation",
      targetField: "address",
      sourceEventId: params.sourceEventId,
      twiml: this.buildAddressConfirmationTwiml(
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
    await this.conversationsService.updateVoiceLastEventId?.(params);
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
      sanitizer: this.sanitizationService,
    });
  }

  private isSoftConfirmationEligible(
    fieldType: "name" | "address",
    candidate: string,
    utterance: string,
    confidence?: number,
  ): boolean {
    if (typeof confidence !== "number") {
      return false;
    }
    const minConfidence = this.config.voiceSoftConfirmMinConfidence ?? 0.85;
    if (confidence < minConfidence) {
      return false;
    }
    const normalizedCandidate =
      fieldType === "name"
        ? normalizeNameCandidate(utterance, this.sanitizationService)
        : this.sanitizationService.normalizeWhitespace(
            voiceAddressCandidatePolicy.normalizeAddressCandidate(
              utterance,
              this.sanitizationService,
            ),
          );
    if (!normalizedCandidate) {
      return false;
    }
    if (fieldType === "name") {
      if (
        !isValidNameCandidate(normalizedCandidate) ||
        !isLikelyNameCandidate(normalizedCandidate)
      ) {
        return false;
      }
    } else if (
      voiceAddressCandidatePolicy.isIncompleteAddress(normalizedCandidate)
    ) {
      return false;
    }
    return (
      normalizedCandidate.trim().toLowerCase() ===
      candidate.trim().toLowerCase()
    );
  }

  private normalizeConfirmationUtterance(value: string): string {
    return normalizeConfirmationUtterance(value);
  }

  private stripConfirmationPrefix(value: string): string {
    return stripConfirmationPrefix(value, this.sanitizationService);
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
    return this.turnSideQuestionRoutingRuntime.continueAfterSideQuestionWithIssueRouting(
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

  private clearIssuePromptAttempts(callSid: string | undefined): void {
    if (!callSid) {
      return;
    }
    this.issuePromptAttemptsByCall.delete(callSid);
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
    return this.turnIssueRecoveryRuntime.replyWithIssueCaptureRecovery({
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
    const bookingMessage = `${params.message} Would you like to book a visit?`
      .replace(/\s+/g, " ")
      .trim();
    return this.replyWithListeningWindow({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      field: "confirmation",
      targetField: "booking",
      sourceEventId: params.sourceEventId,
      twiml: this.buildSayGatherTwiml(
        this.applyCsrStrategy(params.strategy, bookingMessage),
      ),
    });
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

  private isLikelyQuestion(transcript: string): boolean {
    return isLikelyQuestionPolicy(transcript);
  }

  private isBookingIntent(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return isBookingIntentPolicy(normalized);
  }

  private isSlowDownRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return isSlowDownRequestPolicy(normalized);
  }

  private isFrustrationRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return isFrustrationRequestPolicy(normalized);
  }

  private isHumanTransferRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return isHumanTransferRequestPolicy(normalized);
  }

  private isSmsDifferentNumberRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return isSmsDifferentNumberRequestPolicy(normalized);
  }

  private isHangupRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return isHangupRequestPolicy(normalized);
  }

  private isOpeningGreetingOnly(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    if (!normalized) {
      return false;
    }
    if (
      extractNameCandidateDeterministic(transcript, this.sanitizationService)
    ) {
      return false;
    }
    if (this.isLikelyIssueCandidate(this.normalizeIssueCandidate(normalized))) {
      return false;
    }
    return /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|are you there|can you hear me|you there|testing|did you get that)[\s,.!?]*$/.test(
      normalized,
    );
  }

  private isAffirmativeUtterance(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return isAffirmativeUtterancePolicy(normalized);
  }

  private resolveBinaryUtterance(transcript: string): "YES" | "NO" | null {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return resolveBinaryUtterancePolicy(normalized);
  }

  private isNegativeUtterance(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return isNegativeUtterancePolicy(normalized);
  }

  private isDuplicateTranscript(
    collectedData: unknown,
    transcript: string,
    now: Date,
  ): boolean {
    return isDuplicateTranscriptPolicy(collectedData, transcript, now);
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

  private isLikelyAddressInputForName(transcript: string): boolean {
    if (!transcript) {
      return false;
    }
    const normalized = voiceAddressCandidatePolicy.normalizeAddressCandidate(
      transcript,
      this.sanitizationService,
    );
    const lowered = normalized.toLowerCase();
    if (!lowered) {
      return false;
    }
    if (
      /^(?:my\s+address\s+is|the\s+address\s+is|address\s+is|service\s+address\s+is)\b/.test(
        lowered,
      )
    ) {
      return true;
    }
    const stripped = voiceAddressCandidatePolicy.stripAddressLeadIn(
      normalized,
      this.sanitizationService,
    );
    return voiceAddressCandidatePolicy.isLikelyAddressCandidate(stripped);
  }

  private buildAskHouseNumberTwiml(
    strategy?: CsrStrategy,
    street?: string | null,
  ): string {
    const prefix = street ? `I heard ${street}. ` : "";
    const core = `${prefix}What's the house number?`;
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core), {
      timeout: 8,
    });
  }

  private buildAskStreetTwiml(
    strategy?: CsrStrategy,
    houseNumber?: string | null,
  ): string {
    const prefix = houseNumber ? `I heard ${houseNumber}. ` : "";
    const core = `${prefix}What's the street name?`;
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core), {
      timeout: 8,
    });
  }

  private buildAskStreetAddressTwiml(strategy?: CsrStrategy): string {
    const core = "What's the street address?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core), {
      timeout: 8,
    });
  }

  private buildAddressPromptForState(
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>,
    strategy?: CsrStrategy,
  ): string {
    if (voiceAddressCandidatePolicy.hasStructuredAddressParts(addressState)) {
      const missing =
        voiceAddressCandidatePolicy.getAddressMissingParts(addressState);
      if (missing.houseNumber && addressState.street) {
        return this.buildAskHouseNumberTwiml(strategy, addressState.street);
      }
      if (missing.street && addressState.houseNumber) {
        return this.buildAskStreetTwiml(strategy, addressState.houseNumber);
      }
      if (missing.houseNumber && missing.street) {
        if (!missing.locality) {
          return this.buildAskStreetAddressTwiml(strategy);
        }
        return this.buildAskAddressTwiml(strategy);
      }
      if (missing.houseNumber || missing.street) {
        return this.buildAskAddressTwiml(strategy);
      }
      if (missing.locality) {
        return this.buildAddressLocalityPromptTwiml(strategy);
      }
      if (addressState.candidate) {
        return this.buildAddressConfirmationTwiml(
          addressState.candidate,
          strategy,
        );
      }
      return this.buildAskAddressTwiml(strategy);
    }

    if (addressState.candidate) {
      if (
        voiceAddressCandidatePolicy.isIncompleteAddress(addressState.candidate)
      ) {
        return this.buildIncompleteAddressTwiml(
          addressState.candidate,
          strategy,
        );
      }
      if (
        voiceAddressCandidatePolicy.isMissingLocality(addressState.candidate)
      ) {
        return this.buildAddressLocalityPromptTwiml(strategy);
      }
      return this.buildAddressConfirmationTwiml(
        addressState.candidate,
        strategy,
      );
    }
    return this.buildAskAddressTwiml(strategy);
  }

  private toTitleCase(value: string): string {
    return value
      .split(" ")
      .map((part) => {
        const [head, ...rest] = part.split(/([-'])/);
        const rebuilt = [head, ...rest]
          .map((segment) => {
            if (segment === "-" || segment === "'") {
              return segment;
            }
            if (!segment) {
              return "";
            }
            return `${segment[0].toUpperCase()}${segment.slice(1)}`;
          })
          .join("");
        return rebuilt;
      })
      .join(" ");
  }

  private getBodyValue(req: Request, ...keys: string[]): unknown {
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        return body[key];
      }
    }
    return undefined;
  }

  public extractToNumber(req: Request): string | null {
    const value = this.getBodyValue(req, "To", "to");
    return typeof value === "string" ? value : null;
  }

  public getRequestId(req: Request): string | undefined {
    return typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : undefined;
  }

  public extractCallSid(req: Request): string | null {
    const value = this.getBodyValue(req, "CallSid", "callSid");
    return typeof value === "string" ? value : null;
  }

  public extractSpeechResult(req: Request): string | null {
    const value = this.getBodyValue(req, "SpeechResult", "speechResult");
    return typeof value === "string" ? value : null;
  }

  public extractConfidence(req: Request): string | null {
    const value = this.getBodyValue(req, "Confidence", "confidence");
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : null;
  }

  private normalizeConfidence(
    value: string | number | null | undefined,
  ): number | undefined {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }
    const parsed = Number.parseFloat(String(value));
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    if (parsed >= 0 && parsed <= 1) {
      return parsed;
    }
    if (parsed > 1 && parsed <= 100) {
      return parsed / 100;
    }
    return undefined;
  }

  public extractFromNumber(req: Request): string | null {
    const value = this.getBodyValue(req, "From", "from");
    return typeof value === "string" ? value : null;
  }

  private buildTwiml(message: string): string {
    return this.voicePromptComposer.buildTwiml(message);
  }
}
