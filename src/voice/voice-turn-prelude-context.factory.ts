import { Inject, Injectable } from "@nestjs/common";
import appConfig, { type AppConfig } from "../config/app.config";
import { normalizeConfirmationUtterance } from "./intake/voice-field-confirmation.policy";
import {
  isLikelyNameCandidate,
  isValidNameCandidate,
  normalizeNameCandidate,
} from "./intake/voice-name-candidate.policy";
import {
  extractVoiceSmsPhoneCandidate,
  getVoiceCallerPhoneFromCollectedData,
  isVoiceSmsNumberConfirmation,
} from "./intake/voice-sms-phone-confirmation.policy";
import { shouldIgnoreVoiceStreamingTranscript } from "./intake/voice-streaming-transcript.policy";
import { VoiceTurnContextRuntime } from "./voice-turn-context.runtime";
import { VoiceTurnEarlyRoutingRuntime } from "./voice-turn-early-routing.runtime";
import { VoiceTurnExpectedFieldRuntime } from "./voice-turn-expected-field.runtime";
import { VoiceTurnPreludeRuntime } from "./voice-turn-prelude.runtime";
import { VoiceTurnDependencies } from "./voice-turn.dependencies";
import {
  buildUrgencyConfirmTwiml,
  continueAfterSideQuestionWithIssueRouting,
  markVoiceEventProcessed,
  normalizeCsrStrategyForTurn,
  selectCsrStrategy,
} from "./voice-turn-runtime-coordination.helpers";
import {
  LOGGER_CONTEXT,
  type VoiceExpectedField,
  type VoiceListeningWindow,
  type VoiceTurnRuntimeSet,
} from "./voice-turn-runtime.types";

@Injectable()
export class VoiceTurnPreludeContextFactory {
  private runtimes!: VoiceTurnRuntimeSet;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly deps: VoiceTurnDependencies,
  ) {}

  configure(runtimes: VoiceTurnRuntimeSet): void {
    this.runtimes = runtimes;

    runtimes.turnPreludeRuntime = new VoiceTurnPreludeRuntime(
      this.config,
      this.deps.conversationsService,
      this.deps.voiceConversationStateService,
      this.deps.callLogService,
      {
        getVoiceListeningWindow: (collectedData) =>
          this.deps.voiceListeningWindowService.getVoiceListeningWindow(
            collectedData,
          ),
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
              this.deps.voiceListeningWindowService.getVoiceListeningWindow(
                collectedData,
              )?.field === "confirmation",
            isSlowDownRequest: (value) =>
              this.deps.voiceUtteranceService.isSlowDownRequest(value),
            isFrustrationRequest: (value) =>
              this.deps.voiceUtteranceService.isFrustrationRequest(value),
            isHumanTransferRequest: (value) =>
              this.deps.voiceUtteranceService.isHumanTransferRequest(value),
            isSmsDifferentNumberRequest: (value) =>
              this.deps.voiceUtteranceService.isSmsDifferentNumberRequest(
                value,
              ),
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
        buildRepromptTwiml: () =>
          this.deps.voicePromptComposer.buildRepromptTwiml(),
        buildSayGatherTwiml: (message) =>
          this.deps.voicePromptComposer.buildSayGatherTwiml(message),
        replyWithTwiml: (res, twiml) =>
          this.deps.voiceResponseService.replyWithTwiml(res, twiml),
        replyWithNoHandoff: (params) =>
          this.deps.voiceResponseService.replyWithNoHandoff(params),
        replyWithHumanFallback: (params) =>
          this.deps.voiceResponseService.replyWithHumanFallback(params),
      },
    );

    runtimes.turnContextRuntime = new VoiceTurnContextRuntime(
      this.deps.loggingService,
      {
        getVoiceNameState: (collectedData) =>
          this.deps.conversationsService.getVoiceNameState(collectedData),
        getVoiceSmsPhoneState: (collectedData) =>
          this.deps.conversationsService.getVoiceSmsPhoneState(collectedData),
        getVoiceAddressState: (collectedData) =>
          this.deps.conversationsService.getVoiceAddressState(collectedData),
        selectCsrStrategy: (params) => selectCsrStrategy(this.deps, params),
        normalizeCsrStrategyForTurn: (strategy, turnCount) =>
          normalizeCsrStrategyForTurn(strategy, turnCount),
        getVoiceListeningWindow: (collectedData) =>
          this.deps.voiceListeningWindowService.getVoiceListeningWindow(
            collectedData,
          ),
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
          this.deps.voiceListeningWindowService.clearVoiceListeningWindow(
            params,
          ),
        getVoiceLastEventId: (collectedData) =>
          this.deps.voiceListeningWindowService.getVoiceLastEventId(
            collectedData,
          ),
        replyWithTwiml: (res, twiml) =>
          this.deps.voiceResponseService.replyWithTwiml(res, twiml),
        buildListeningWindowReprompt: (params) =>
          this.deps.voiceListeningWindowService.buildListeningWindowReprompt(
            params,
          ),
        markVoiceEventProcessed: (params) =>
          markVoiceEventProcessed(this.deps, params),
        getExpectedListeningField: (window) =>
          this.deps.voiceListeningWindowService.getExpectedListeningField(
            window,
          ),
        isVoiceFieldReady: (locked, confirmed) =>
          this.deps.voiceTurnPolicyService.isVoiceFieldReady(locked, confirmed),
      },
    );

    runtimes.turnEarlyRoutingRuntime = new VoiceTurnEarlyRoutingRuntime({
      resolveBinaryUtterance: (transcript) =>
        this.deps.voiceUtteranceService.resolveBinaryUtterance(transcript),
      isBookingIntent: (transcript) =>
        this.deps.voiceUtteranceService.isBookingIntent(transcript),
      clearVoiceListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.clearVoiceListeningWindow(params),
      replyWithTwiml: (res, twiml) =>
        this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildBookingPromptTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildBookingPromptTwiml(strategy),
      replyWithHumanFallback: (params) =>
        this.deps.voiceResponseService.replyWithHumanFallback(params),
      buildCallbackOfferTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildCallbackOfferTwiml(strategy),
      handleExpectedUrgencyField: (params) =>
        this.deps.voiceUrgencySlotService.handleExpectedField(params),
      continueAfterSideQuestionWithIssueRouting: (params) =>
        continueAfterSideQuestionWithIssueRouting(this.runtimes, params),
      buildUrgencyConfirmTwiml: (strategy, opts) =>
        buildUrgencyConfirmTwiml(this.deps, strategy, opts),
    });

    runtimes.turnExpectedFieldRuntime = new VoiceTurnExpectedFieldRuntime({
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
        this.runtimes.turnHandoffRuntime.replyWithSmsHandoff(params),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildAskSmsNumberTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildAskSmsNumberTwiml(strategy),
      replyWithHumanFallback: (params) =>
        this.deps.voiceResponseService.replyWithHumanFallback(params),
      loggerContext: LOGGER_CONTEXT,
    });
  }
}
