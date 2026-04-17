import { CommunicationChannel } from "@prisma/client";
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
import type { VoiceTurnDependencies } from "./voice-turn.dependencies";
import {
  getVoiceAddressStateFromCollectedData,
  getVoiceNameStateFromCollectedData,
  getVoiceSmsHandoffFromCollectedData,
  getVoiceSmsPhoneStateFromCollectedData,
} from "../conversations/voice-conversation-state.codec";
import type { AppConfig } from "../config/app.config";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { CsrStrategySelector } from "./csr-strategy.selector";
import type { ICallLogService } from "../logging/call-log.service.interface";
import type { VoiceSmsPhoneSlotService } from "./voice-sms-phone-slot.service";
import type { VoiceUrgencySlotService } from "./voice-urgency-slot.service";
import {
  buildUrgencyConfirmTwiml,
  continueAfterSideQuestionWithIssueRouting,
  markVoiceEventProcessed,
  normalizeCsrStrategyForTurn,
} from "./voice-turn-runtime-coordination.helpers";
import {
  LOGGER_CONTEXT,
  type VoiceExpectedField,
  type VoiceListeningWindow,
  type VoiceTurnRuntimeSet,
} from "./voice-turn-runtime.types";

type PreludeRuntimeBuilderParams = {
  config: AppConfig;
  deps: VoiceTurnDependencies;
  conversationsService: IConversationsService;
  callLogService: ICallLogService;
};

type ContextRuntimeBuilderParams = {
  deps: VoiceTurnDependencies;
  csrStrategySelector: CsrStrategySelector;
};

type EarlyRoutingRuntimeBuilderParams = {
  deps: VoiceTurnDependencies;
  voiceUrgencySlotService: VoiceUrgencySlotService;
  runtimes: VoiceTurnRuntimeSet;
};

type ExpectedFieldRuntimeBuilderParams = {
  deps: VoiceTurnDependencies;
  voiceSmsPhoneSlotService: VoiceSmsPhoneSlotService;
  runtimes: VoiceTurnRuntimeSet;
};

export function createTurnPreludeRuntime(
  params: PreludeRuntimeBuilderParams,
): VoiceTurnPreludeRuntime {
  const { config, deps, conversationsService, callLogService } = params;
  return new VoiceTurnPreludeRuntime(
    config,
    conversationsService,
    {
      updateVoiceTranscript: (input) =>
        deps.voiceTranscriptState.updateVoiceTranscript(input),
      incrementVoiceTurn: (input) =>
        deps.voiceTurnOrchestration.incrementVoiceTurn(input),
    },
    callLogService,
    {
      getVoiceListeningWindow: (collectedData) =>
        deps.voiceListeningWindowService.getVoiceListeningWindow(collectedData),
      getExpectedListeningField: (listeningWindow) =>
        deps.voiceListeningWindowService.getExpectedListeningField(
          listeningWindow as VoiceListeningWindow | null,
        ),
      shouldIgnoreStreamingTranscript: (transcript, collectedData, expectedField) =>
        shouldIgnoreVoiceStreamingTranscript({
          transcript,
          expectedField: expectedField as VoiceExpectedField | null,
          isConfirmationWindow:
            deps.voiceListeningWindowService.getVoiceListeningWindow(
              collectedData,
            )?.field === "confirmation",
          isSlowDownRequest: (value) =>
            deps.voiceUtteranceService.isSlowDownRequest(value),
          isFrustrationRequest: (value) =>
            deps.voiceUtteranceService.isFrustrationRequest(value),
          isHumanTransferRequest: (value) =>
            deps.voiceUtteranceService.isHumanTransferRequest(value),
          isSmsDifferentNumberRequest: (value) =>
            deps.voiceUtteranceService.isSmsDifferentNumberRequest(value),
          isHangupRequest: (value) => deps.voiceUtteranceService.isHangupRequest(value),
          resolveBinaryUtterance: (value) =>
            deps.voiceUtteranceService.resolveBinaryUtterance(value),
          normalizeNameCandidate: (value) =>
            normalizeNameCandidate(value, deps.sanitizationService),
          isValidNameCandidate: (value) => isValidNameCandidate(value),
          isLikelyNameCandidate: (value) => isLikelyNameCandidate(value),
          normalizeIssueCandidate: (value) =>
            deps.voiceTurnPolicyService.normalizeIssueCandidate(value),
          isLikelyIssueCandidate: (value) =>
            deps.voiceTurnPolicyService.isLikelyIssueCandidate(value),
          normalizeConfirmationUtterance: (value) =>
            normalizeConfirmationUtterance(value),
          isSmsNumberConfirmation: (value) => isVoiceSmsNumberConfirmation(value),
        }),
      isDuplicateTranscript: (collectedData, transcript, now) =>
        deps.voiceUtteranceService.isDuplicateTranscript(
          collectedData,
          transcript,
          now,
        ),
      normalizeConfidence: (value) =>
        deps.voiceTurnPolicyService.normalizeConfidence(value),
      getTenantDisplayName: (tenant) =>
        deps.voiceTurnPolicyService.getTenantDisplayName(tenant),
      buildRepromptTwiml: () => deps.voicePromptComposer.buildRepromptTwiml(),
      buildSayGatherTwiml: (message) =>
        deps.voicePromptComposer.buildSayGatherTwiml(message),
      replyWithTwiml: (res, twiml) => deps.voiceResponseService.replyWithTwiml(res, twiml),
      replyWithNoHandoff: (input) =>
        deps.voiceResponseService.replyWithNoHandoff(input),
      replyWithHumanFallback: (input) =>
        deps.voiceResponseService.replyWithHumanFallback(input),
    },
  );
}

export function createTurnContextRuntime(
  params: ContextRuntimeBuilderParams,
): VoiceTurnContextRuntime {
  const { deps, csrStrategySelector } = params;
  return new VoiceTurnContextRuntime(deps.loggingService, {
    getVoiceNameState: (collectedData) =>
      getVoiceNameStateFromCollectedData(collectedData),
    getVoiceSmsPhoneState: (collectedData) =>
      getVoiceSmsPhoneStateFromCollectedData(collectedData),
    getVoiceAddressState: (collectedData) =>
      getVoiceAddressStateFromCollectedData(collectedData),
    selectCsrStrategy: (input) => {
      const hasConfirmedName =
        Boolean(input.nameState.confirmed.value) ||
        deps.voiceTurnPolicyService.isVoiceFieldReady(
          input.nameState.locked,
          input.nameState.confirmed.value,
        );
      const hasConfirmedAddress =
        Boolean(input.addressState.confirmed) ||
        deps.voiceTurnPolicyService.isVoiceFieldReady(
          input.addressState.locked,
          input.addressState.confirmed,
        ) ||
        Boolean(input.addressState.smsConfirmNeeded);
      return csrStrategySelector.selectStrategy({
        channel: CommunicationChannel.VOICE,
        fsmState: input.conversation.currentFSMState ?? null,
        hasConfirmedName,
        hasConfirmedAddress,
        urgency: deps.voiceTurnPolicyService.isUrgencyEmergency(
          input.collectedData,
        ),
        isPaymentRequiredNext:
          deps.voiceTurnPolicyService.isPaymentRequiredNext(input.collectedData),
      });
    },
    normalizeCsrStrategyForTurn: (strategy, turnCount) =>
      normalizeCsrStrategyForTurn(strategy, turnCount),
    getVoiceListeningWindow: (collectedData) =>
      deps.voiceListeningWindowService.getVoiceListeningWindow(collectedData),
    shouldClearListeningWindow: (
      listeningWindow,
      now,
      nameState,
      addressState,
      phoneState,
    ) =>
      deps.voiceListeningWindowService.shouldClearListeningWindow(
        listeningWindow,
        now,
        nameState,
        addressState,
        phoneState,
      ),
    clearVoiceListeningWindow: (input) =>
      deps.voiceListeningWindowService.clearVoiceListeningWindow(input),
    getVoiceLastEventId: (collectedData) =>
      deps.voiceListeningWindowService.getVoiceLastEventId(collectedData),
    replyWithTwiml: (res, twiml) => deps.voiceResponseService.replyWithTwiml(res, twiml),
    buildListeningWindowReprompt: (input) =>
      deps.voiceListeningWindowService.buildListeningWindowReprompt(input),
    markVoiceEventProcessed: (input) => markVoiceEventProcessed(deps, input),
    getExpectedListeningField: (window) =>
      deps.voiceListeningWindowService.getExpectedListeningField(window),
    isVoiceFieldReady: (locked, confirmed) =>
      deps.voiceTurnPolicyService.isVoiceFieldReady(locked, confirmed),
  });
}

export function createTurnEarlyRoutingRuntime(
  params: EarlyRoutingRuntimeBuilderParams,
): VoiceTurnEarlyRoutingRuntime {
  const { deps, voiceUrgencySlotService, runtimes } = params;
  return new VoiceTurnEarlyRoutingRuntime({
    resolveBinaryUtterance: (transcript) =>
      deps.voiceUtteranceService.resolveBinaryUtterance(transcript),
    isBookingIntent: (transcript) =>
      deps.voiceUtteranceService.isBookingIntent(transcript),
    clearVoiceListeningWindow: (input) =>
      deps.voiceListeningWindowService.clearVoiceListeningWindow(input),
    replyWithTwiml: (res, twiml) => deps.voiceResponseService.replyWithTwiml(res, twiml),
    buildSayGatherTwiml: (message) =>
      deps.voicePromptComposer.buildSayGatherTwiml(message),
    replyWithListeningWindow: (input) =>
      deps.voiceListeningWindowService.replyWithListeningWindow(input),
    buildBookingPromptTwiml: (strategy) =>
      deps.voicePromptComposer.buildBookingPromptTwiml(strategy),
    replyWithHumanFallback: (input) =>
      deps.voiceResponseService.replyWithHumanFallback(input),
    buildCallbackOfferTwiml: (strategy) =>
      deps.voicePromptComposer.buildCallbackOfferTwiml(strategy),
    handleExpectedUrgencyField: (input) =>
      voiceUrgencySlotService.handleExpectedField(input),
    continueAfterSideQuestionWithIssueRouting: (input) =>
      continueAfterSideQuestionWithIssueRouting(runtimes, input),
    buildUrgencyConfirmTwiml: (strategy, opts) =>
      buildUrgencyConfirmTwiml(deps, strategy, opts),
  });
}

export function createTurnExpectedFieldRuntime(
  params: ExpectedFieldRuntimeBuilderParams,
): VoiceTurnExpectedFieldRuntime {
  const { deps, voiceSmsPhoneSlotService, runtimes } = params;
  return new VoiceTurnExpectedFieldRuntime({
    getVoiceSmsHandoff: (collectedData) =>
      getVoiceSmsHandoffFromCollectedData(collectedData),
    getCallerPhoneFromCollectedData: (collectedData) =>
      getVoiceCallerPhoneFromCollectedData(collectedData),
    normalizeConfirmationUtterance: (value) => normalizeConfirmationUtterance(value),
    isSmsNumberConfirmation: (transcript) =>
      isVoiceSmsNumberConfirmation(transcript),
    extractSmsPhoneCandidate: (transcript) =>
      extractVoiceSmsPhoneCandidate(transcript, (value) =>
        deps.sanitizationService.normalizePhoneE164(value),
      ),
    handleExpectedSmsPhoneField: (input) =>
      voiceSmsPhoneSlotService.handleExpectedField(input),
    replyWithSmsHandoff: (input) =>
      runtimes.turnHandoffRuntime.replyWithSmsHandoff(input),
    replyWithListeningWindow: (input) =>
      deps.voiceListeningWindowService.replyWithListeningWindow(input),
    buildAskSmsNumberTwiml: (strategy) =>
      deps.voicePromptComposer.buildAskSmsNumberTwiml(strategy),
    replyWithHumanFallback: (input) =>
      deps.voiceResponseService.replyWithHumanFallback(input),
    loggerContext: LOGGER_CONTEXT,
  });
}
