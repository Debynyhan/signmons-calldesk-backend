import type { Response } from "express";
import { CommunicationChannel, Prisma } from "@prisma/client";
import { CsrStrategy } from "./csr-strategy.selector";
import type { VoiceTurnDependencies } from "./voice-turn.dependencies";
import type {
  VoiceAddressState,
  VoiceListeningField,
  VoiceNameState,
  VoiceTurnRuntimeSet,
  VoiceTurnTimingCollector,
} from "./voice-turn-runtime.types";

export function applyCsrStrategy(
  deps: VoiceTurnDependencies,
  strategy: CsrStrategy | undefined,
  message: string,
): string {
  return deps.voicePromptComposer.applyCsrStrategy(strategy, message);
}

export function buildUrgencyConfirmTwiml(
  deps: VoiceTurnDependencies,
  strategy?: CsrStrategy,
  context?: {
    callerName?: string | null;
    issueCandidate?: string | null;
  },
): string {
  return deps.voicePromptComposer.buildUrgencyConfirmTwiml(strategy, {
    callerName: context?.callerName,
    issueSummary: context?.issueCandidate
      ? deps.voiceTurnPolicyService.buildIssueAcknowledgement(
          context.issueCandidate,
        )
      : null,
  });
}

export function buildAddressPromptForState(
  deps: VoiceTurnDependencies,
  addressState: VoiceAddressState,
  strategy?: CsrStrategy,
): string {
  return deps.voiceAddressPromptService.buildAddressPromptForState({
    addressState,
    strategy,
    applyCsrStrategy: (runtimeStrategy, message) =>
      applyCsrStrategy(deps, runtimeStrategy, message),
  });
}

export function selectCsrStrategy(
  deps: VoiceTurnDependencies,
  params: {
    conversation: { currentFSMState?: string | null };
    collectedData: unknown;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
  },
): CsrStrategy {
  const hasConfirmedName =
    Boolean(params.nameState.confirmed.value) ||
    deps.voiceTurnPolicyService.isVoiceFieldReady(
      params.nameState.locked,
      params.nameState.confirmed.value,
    );

  const hasConfirmedAddress =
    Boolean(params.addressState.confirmed) ||
    deps.voiceTurnPolicyService.isVoiceFieldReady(
      params.addressState.locked,
      params.addressState.confirmed,
    ) ||
    Boolean(params.addressState.smsConfirmNeeded);

  return deps.csrStrategySelector.selectStrategy({
    channel: CommunicationChannel.VOICE,
    fsmState: params.conversation.currentFSMState ?? null,
    hasConfirmedName,
    hasConfirmedAddress,
    urgency: deps.voiceTurnPolicyService.isUrgencyEmergency(
      params.collectedData,
    ),
    isPaymentRequiredNext: deps.voiceTurnPolicyService.isPaymentRequiredNext(
      params.collectedData,
    ),
  });
}

export function normalizeCsrStrategyForTurn(
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

export async function markVoiceEventProcessed(
  deps: VoiceTurnDependencies,
  params: {
    tenantId: string;
    conversationId: string;
    eventId: string;
  },
): Promise<void> {
  await deps.voiceConversationStateService.updateVoiceLastEventId(params);
}

export async function continueAfterSideQuestionWithIssueRouting(
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
  return runtimes.turnSideQuestionRoutingRuntime.continueAfterSideQuestionWithIssueRouting(
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
      collectedData: (params.collectedData as Prisma.JsonValue | null) ?? null,
      currentEventId: params.currentEventId,
      strategy: params.strategy,
      timingCollector: params.timingCollector,
    },
  );
}

export async function replyWithIssueCaptureRecovery(
  runtimes: VoiceTurnRuntimeSet,
  params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: unknown;
    strategy?: CsrStrategy;
    reason: string;
    promptPrefix?: string;
    transcript?: string;
  },
): Promise<string> {
  return runtimes.turnIssueRecoveryRuntime.replyWithIssueCaptureRecovery({
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

export async function replyWithBookingOffer(
  runtimes: VoiceTurnRuntimeSet,
  params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    sourceEventId: string | null;
    message: string;
    strategy?: CsrStrategy;
  },
): Promise<string> {
  return runtimes.turnHandoffRuntime.replyWithBookingOffer(params);
}

export async function trackAiCall<T>(
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
