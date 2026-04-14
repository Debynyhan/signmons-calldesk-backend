import { Inject, Injectable } from "@nestjs/common";
import appConfig, { type AppConfig } from "../config/app.config";
import { VoiceTurnAddressCompletenessRuntime } from "./voice-turn-address-completeness.runtime";
import { VoiceTurnAddressConfirmedRuntime } from "./voice-turn-address-confirmed.runtime";
import { VoiceTurnAddressExistingCandidateRuntime } from "./voice-turn-address-existing-candidate.runtime";
import { VoiceTurnAddressExtractionRuntime } from "./voice-turn-address-extraction.runtime";
import { VoiceTurnAddressRoutingRuntime } from "./voice-turn-address-routing.runtime";
import {
  continueAfterSideQuestionWithIssueRoutingFromAddress,
  deferAddressToSmsAuthority,
  handleMissingLocalityPrompt,
  replyWithAddressConfirmationWindow,
  replyWithAddressPromptWindow,
  resolveAddressConfirmation,
} from "./voice-turn-address-flow.helpers";
import { VoiceTurnDependencies } from "./voice-turn.dependencies";
import {
  buildAddressPromptForState,
  trackAiCall,
} from "./voice-turn-runtime-coordination.helpers";
import {
  LOGGER_CONTEXT,
  type VoiceTurnRuntimeSet,
} from "./voice-turn-runtime.types";

@Injectable()
export class VoiceTurnAddressFlowFactory {
  private runtimes!: VoiceTurnRuntimeSet;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly deps: VoiceTurnDependencies,
  ) {}

  configure(runtimes: VoiceTurnRuntimeSet): void {
    this.runtimes = runtimes;

    runtimes.turnAddressExtractionRuntime =
      new VoiceTurnAddressExtractionRuntime({
        sanitizer: this.deps.sanitizationService,
        voiceAddressMinConfidence: this.config.voiceAddressMinConfidence ?? 0.7,
        extractAddressCandidate: (tenantId, transcript, timingCollector) =>
          trackAiCall(timingCollector, () =>
            this.deps.aiService.extractAddressCandidate(tenantId, transcript),
          ),
        updateVoiceAddressState: (params) =>
          this.deps.voiceAddressSlot.updateVoiceAddressState(params),
        deferAddressToSmsAuthority: (params) =>
          deferAddressToSmsAuthority(this.deps, this.runtimes, params),
        replyWithAddressPromptWindow: (params) =>
          replyWithAddressPromptWindow(this.deps, params),
        handleMissingLocalityPrompt: (params) =>
          handleMissingLocalityPrompt(this.deps, this.runtimes, params),
        replyWithAddressConfirmationWindow: (params) =>
          replyWithAddressConfirmationWindow(this.deps, params),
      });

    runtimes.turnAddressCompletenessRuntime =
      new VoiceTurnAddressCompletenessRuntime({
        handleMissingLocalityPrompt: (params) =>
          handleMissingLocalityPrompt(this.deps, this.runtimes, params),
        replyWithAddressPromptWindow: (params) =>
          replyWithAddressPromptWindow(this.deps, params),
      });

    runtimes.turnAddressConfirmedRuntime = new VoiceTurnAddressConfirmedRuntime(
      {
        updateVoiceAddressState: (params) =>
          this.deps.voiceAddressSlot.updateVoiceAddressState(params),
        clearVoiceListeningWindow: (params) =>
          this.deps.voiceListeningWindowService.clearVoiceListeningWindow(
            params,
          ),
        getVoiceIssueCandidate: (collectedData) =>
          this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(
            collectedData,
          ),
        continueAfterSideQuestionWithIssueRouting: (params) =>
          continueAfterSideQuestionWithIssueRoutingFromAddress(
            this.runtimes,
            params,
          ),
        buildSayGatherTwiml: (message) =>
          this.deps.voicePromptComposer.buildSayGatherTwiml(message),
        replyWithTwiml: (res, twiml) =>
          this.deps.voiceResponseService.replyWithTwiml(res, twiml),
        log: (payload) => this.deps.loggingService.log(payload, LOGGER_CONTEXT),
      },
    );

    runtimes.turnAddressExistingCandidateRuntime =
      new VoiceTurnAddressExistingCandidateRuntime({
        sanitizer: this.deps.sanitizationService,
        updateVoiceAddressState: (params) =>
          this.deps.voiceAddressSlot.updateVoiceAddressState(params),
        replyWithAddressConfirmationWindow: (params) =>
          replyWithAddressConfirmationWindow(this.deps, params),
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
          this.deps.voiceListeningWindowService.replyWithListeningWindow(
            params,
          ),
        buildAddressSoftConfirmationTwiml: (candidate, strategy) =>
          this.deps.voicePromptComposer.buildAddressSoftConfirmationTwiml(
            candidate,
            strategy,
          ),
        resolveConfirmation: (utterance, currentCandidate, fieldType) =>
          resolveAddressConfirmation(
            this.deps,
            utterance,
            currentCandidate,
            fieldType,
          ),
        routeAddressCompleteness: (params) =>
          this.runtimes.turnAddressCompletenessRuntime.routeAddressCompleteness(
            params,
          ),
        handleAddressConfirmedContinuation: (params) =>
          this.runtimes.turnAddressConfirmedRuntime.handleAddressConfirmedContinuation(
            params,
          ),
        deferAddressToSmsAuthority: (params) =>
          deferAddressToSmsAuthority(this.deps, this.runtimes, params),
        replyWithAddressPromptWindow: (params) =>
          replyWithAddressPromptWindow(this.deps, params),
        buildYesNoRepromptTwiml: (strategy) =>
          this.deps.voicePromptComposer.buildYesNoRepromptTwiml(strategy),
      });

    runtimes.turnAddressRoutingRuntime = new VoiceTurnAddressRoutingRuntime({
      sanitizer: this.deps.sanitizationService,
      deferAddressToSmsAuthority: (params) =>
        deferAddressToSmsAuthority(this.deps, this.runtimes, params),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildSayGatherTwiml: (message, options) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message, options),
      buildAddressPromptForState: (addressState, strategy) =>
        buildAddressPromptForState(this.deps, addressState, strategy),
      updateVoiceAddressState: (params) =>
        this.deps.voiceAddressSlot.updateVoiceAddressState(params),
      handleMissingLocalityPrompt: (params) =>
        handleMissingLocalityPrompt(this.deps, this.runtimes, params),
      replyWithAddressPromptWindow: (params) =>
        replyWithAddressPromptWindow(this.deps, params),
      replyWithAddressConfirmationWindow: (params) =>
        replyWithAddressConfirmationWindow(this.deps, params),
      routeAddressCompleteness: (params) =>
        this.runtimes.turnAddressCompletenessRuntime.routeAddressCompleteness(
          params,
        ),
      handleAddressExistingCandidate: (params) =>
        this.runtimes.turnAddressExistingCandidateRuntime.handleAddressExistingCandidate(
          params,
        ),
      buildSideQuestionReply: (tenantId, transcript) =>
        this.runtimes.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
    });
  }
}
