import type { Response } from "express";
import {
  LOGGER_CONTEXT,
  type VoiceTurnRuntimeSet,
} from "./voice-turn-runtime.types";
import type {
  VoiceAddressState,
  VoiceListeningField,
  VoiceNameState,
  VoiceTurnTimingCollector,
} from "./voice-turn-runtime.types";
import type { CsrStrategy } from "./csr-strategy.selector";
import type { VoiceTurnDependencies } from "./voice-turn.dependencies";
import {
  resolveConfirmation,
  type VoiceConfirmationResolution,
} from "./intake/voice-field-confirmation.policy";
import {
  applyCsrStrategy,
  buildAddressPromptForState,
  continueAfterSideQuestionWithIssueRouting,
} from "./voice-turn-runtime-coordination.helpers";

export async function handleMissingLocalityPrompt(
  deps: VoiceTurnDependencies,
  runtimes: VoiceTurnRuntimeSet,
  params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    candidate: string;
    addressState: VoiceAddressState;
    nameState: VoiceNameState;
    collectedData: unknown;
    currentEventId: string | null;
    displayName: string;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  },
): Promise<string> {
  const nextAttempt = params.addressState.attemptCount + 1;
  const shouldFailClosed = nextAttempt >= 2;
  const nextAddressState: VoiceAddressState = {
    ...params.addressState,
    candidate: params.candidate,
    status: shouldFailClosed ? "FAILED" : "CANDIDATE",
    attemptCount: nextAttempt,
    needsLocality: !shouldFailClosed,
    sourceEventId: params.currentEventId,
  };

  await deps.voiceAddressSlot.updateVoiceAddressState({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    addressState: nextAddressState,
  });

  if (shouldFailClosed) {
    return deferAddressToSmsAuthority(deps, runtimes, {
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

  return deps.voiceListeningWindowService.replyWithListeningWindow({
    res: params.res,
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    field: "address",
    sourceEventId: params.currentEventId,
    twiml: deps.voicePromptComposer.buildAddressLocalityPromptTwiml(
      params.strategy,
    ),
  });
}

export async function deferAddressToSmsAuthority(
  deps: VoiceTurnDependencies,
  runtimes: VoiceTurnRuntimeSet,
  params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    currentEventId: string | null;
    addressState: VoiceAddressState;
    nameState: VoiceNameState;
    collectedData: unknown;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  },
): Promise<string> {
  const nextAddressState: VoiceAddressState = {
    ...params.addressState,
    status: "FAILED",
    smsConfirmNeeded: true,
    needsLocality: false,
    sourceEventId:
      params.currentEventId ?? params.addressState.sourceEventId ?? null,
  };

  await deps.voiceAddressSlot.updateVoiceAddressState({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    addressState: nextAddressState,
  });

  deps.loggingService.log(
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

  await deps.voiceListeningWindowService.clearVoiceListeningWindow({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
  });

  const issueCandidate = deps.voiceTurnPolicyService.getVoiceIssueCandidate(
    params.collectedData,
  );
  if (issueCandidate?.value) {
    const includeFees = deps.voiceTurnPolicyService.shouldDiscloseFees({
      nameState: params.nameState,
      addressState: nextAddressState,
      collectedData: params.collectedData,
    });
    const feePolicy = includeFees
      ? await deps.voiceHandoffPolicy.getTenantFeePolicySafe(params.tenantId)
      : null;
    const smsMessage =
      deps.voiceSmsHandoffService.buildSmsHandoffMessageForContext({
        feePolicy,
        includeFees,
        isEmergency: deps.voiceTurnPolicyService.isUrgencyEmergency(
          params.collectedData,
        ),
        callerFirstName: deps.voiceTurnPolicyService
          .getVoiceNameCandidate(params.nameState)
          ?.split(" ")
          .filter(Boolean)[0],
      });

    return runtimes.turnHandoffRuntime.replyWithSmsHandoff({
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

  return deps.voiceResponseService.replyWithTwiml(
    params.res,
    deps.voicePromptComposer.buildSayGatherTwiml(
      applyCsrStrategy(deps, params.strategy, message),
    ),
  );
}

export async function replyWithAddressPromptWindow(
  deps: VoiceTurnDependencies,
  params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
    addressState: VoiceAddressState;
    strategy?: CsrStrategy;
  },
): Promise<string> {
  return deps.voiceListeningWindowService.replyWithListeningWindow({
    res: params.res,
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    field: "address",
    sourceEventId: params.sourceEventId,
    twiml: buildAddressPromptForState(
      deps,
      params.addressState,
      params.strategy,
    ),
  });
}

export async function replyWithAddressConfirmationWindow(
  deps: VoiceTurnDependencies,
  params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
    candidate: string;
    strategy?: CsrStrategy;
  },
): Promise<string> {
  return deps.voiceListeningWindowService.replyWithListeningWindow({
    res: params.res,
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    field: "confirmation",
    targetField: "address",
    sourceEventId: params.sourceEventId,
    twiml: deps.voicePromptComposer.buildAddressConfirmationTwiml(
      params.candidate,
      params.strategy,
    ),
  });
}

export function resolveAddressConfirmation(
  deps: VoiceTurnDependencies,
  utterance: string,
  currentCandidate: string | null,
  fieldType: "name" | "address",
): VoiceConfirmationResolution {
  return resolveConfirmation({
    utterance,
    currentCandidate,
    fieldType,
    sanitizer: deps.sanitizationService,
  });
}

export async function continueAfterSideQuestionWithIssueRoutingFromAddress(
  runtimes: VoiceTurnRuntimeSet,
  params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    sideQuestionReply: string;
    expectedField: VoiceListeningField | null;
    nameReady: boolean;
    addressReady: boolean;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: unknown;
    currentEventId: string | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  },
): Promise<string> {
  return continueAfterSideQuestionWithIssueRouting(runtimes, params);
}
