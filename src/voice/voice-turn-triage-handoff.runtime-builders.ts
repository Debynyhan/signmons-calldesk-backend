import type { TenantFeePolicy as PrismaTenantFeePolicy } from "@prisma/client";
import { stripConfirmationPrefix } from "./intake/voice-field-confirmation.policy";
import { VoiceTurnInterruptRuntime } from "./voice-turn-interrupt.runtime";
import { VoiceTurnSideQuestionHelperRuntime } from "./voice-turn-side-question-helper.runtime";
import type { CsrStrategy } from "./csr-strategy.selector";
import type { VoiceTurnDependencies } from "./voice-turn.dependencies";
import type { VoiceAddressState } from "./voice-turn-runtime.types";

export function createTurnInterruptRuntime(
  deps: VoiceTurnDependencies,
): VoiceTurnInterruptRuntime {
  return new VoiceTurnInterruptRuntime(
    {
      isSlowDownRequest: (transcript) =>
        deps.voiceUtteranceService.isSlowDownRequest(transcript),
      replyWithListeningWindow: (params) =>
        deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildTakeYourTimeTwiml: (field, strategy) =>
        deps.voicePromptComposer.buildTakeYourTimeTwiml(field, strategy),
      replyWithTwiml: (res, twiml) =>
        deps.voiceResponseService.replyWithTwiml(res, twiml),
      buildSayGatherTwiml: (message) =>
        deps.voicePromptComposer.buildSayGatherTwiml(message),
    },
    {
      isHangupRequest: (transcript) =>
        deps.voiceUtteranceService.isHangupRequest(transcript),
      clearIssuePromptAttempts: (callSid) =>
        deps.voiceResponseService.clearIssuePromptAttempts(callSid),
      replyWithTwiml: (res, twiml) =>
        deps.voiceResponseService.replyWithTwiml(res, twiml),
      buildTwiml: (message) => deps.voicePromptComposer.buildTwiml(message),
      isHumanTransferRequest: (transcript) =>
        deps.voiceUtteranceService.isHumanTransferRequest(transcript),
      replyWithListeningWindow: (params) =>
        deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildCallbackOfferTwiml: (strategy) =>
        deps.voicePromptComposer.buildCallbackOfferTwiml(strategy),
      isSmsDifferentNumberRequest: (transcript) =>
        deps.voiceUtteranceService.isSmsDifferentNumberRequest(transcript),
      updateVoiceSmsHandoff: (params) =>
        deps.voiceConversationStateService.updateVoiceSmsHandoff(params),
      updateVoiceSmsPhoneState: (params) =>
        deps.voiceConversationStateService.updateVoiceSmsPhoneState(params),
      buildAskSmsNumberTwiml: (strategy) =>
        deps.voicePromptComposer.buildAskSmsNumberTwiml(strategy),
    },
  );
}

export function createTurnSideQuestionHelperRuntime(
  deps: VoiceTurnDependencies,
  buildAddressPromptForState: (
    addressState: VoiceAddressState,
    strategy?: CsrStrategy,
  ) => string,
): VoiceTurnSideQuestionHelperRuntime {
  return new VoiceTurnSideQuestionHelperRuntime({
    normalizeWhitespace: (value) =>
      deps.sanitizationService.normalizeWhitespace(value),
    stripConfirmationPrefix: (value) =>
      stripConfirmationPrefix(value, deps.sanitizationService),
    isLikelyQuestion: (value) =>
      deps.voiceUtteranceService.isLikelyQuestion(value),
    getTenantFeePolicySafe: (tenantId) =>
      deps.voiceHandoffPolicy.getTenantFeePolicySafe(tenantId),
    getTenantFeeConfig: (policy) =>
      deps.voiceHandoffPolicy.getTenantFeeConfig(
        policy as PrismaTenantFeePolicy | null,
      ),
    formatFeeAmount: (value) => deps.voiceHandoffPolicy.formatFeeAmount(value),
    getTenantDisplayNameById: async (tenantId) => {
      try {
        const tenant = await deps.tenantsService.getTenantContext(tenantId);
        return tenant.displayName;
      } catch {
        return null;
      }
    },
    buildAskNameTwiml: (strategy) =>
      deps.voicePromptComposer.buildAskNameTwiml(strategy),
    prependPrefaceToGatherTwiml: (preface, twiml) =>
      deps.voicePromptComposer.prependPrefaceToGatherTwiml(preface, twiml),
    replyWithListeningWindow: (params) =>
      deps.voiceListeningWindowService.replyWithListeningWindow(params),
    buildAddressPromptForState,
    buildAskSmsNumberTwiml: (strategy) =>
      deps.voicePromptComposer.buildAskSmsNumberTwiml(strategy),
    buildBookingPromptTwiml: (strategy) =>
      deps.voicePromptComposer.buildBookingPromptTwiml(strategy),
    buildCallbackOfferTwiml: (strategy) =>
      deps.voicePromptComposer.buildCallbackOfferTwiml(strategy),
  });
}
