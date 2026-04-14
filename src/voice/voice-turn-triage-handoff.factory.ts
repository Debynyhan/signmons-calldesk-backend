import { Injectable } from "@nestjs/common";
import { CommunicationChannel } from "@prisma/client";
import type { TenantFeePolicy as PrismaTenantFeePolicy } from "@prisma/client";
import { normalizeConfirmationUtterance } from "./intake/voice-field-confirmation.policy";
import { VoiceTurnAiTriageRuntime } from "./voice-turn-ai-triage.runtime";
import { VoiceTurnHandoffRuntime } from "./voice-turn-handoff.runtime";
import { VoiceTurnIssueRecoveryRuntime } from "./voice-turn-issue-recovery.runtime";
import { VoiceTurnSideQuestionRoutingRuntime } from "./voice-turn-side-question-routing.runtime";
import { VoiceTurnSideQuestionRuntime } from "./voice-turn-side-question.runtime";
import { VoiceTurnDependencies } from "./voice-turn.dependencies";
import { VoiceIntakeSmsService } from "../payments/voice-intake-sms.service";
import {
  applyCsrStrategy,
  buildAddressPromptForState,
  buildUrgencyConfirmTwiml,
  continueAfterSideQuestionWithIssueRouting,
  replyWithBookingOffer,
  replyWithIssueCaptureRecovery,
  trackAiCall,
} from "./voice-turn-runtime-coordination.helpers";
import {
  LOGGER_CONTEXT,
  type VoiceTurnRuntimeSet,
} from "./voice-turn-runtime.types";
import {
  createTurnInterruptRuntime,
  createTurnSideQuestionHelperRuntime,
} from "./voice-turn-triage-handoff.runtime-builders";

@Injectable()
export class VoiceTurnTriageHandoffFactory {
  private runtimes!: VoiceTurnRuntimeSet;

  constructor(
    private readonly deps: VoiceTurnDependencies,
    private readonly voiceIntakeSmsService: VoiceIntakeSmsService,
  ) {}

  configure(runtimes: VoiceTurnRuntimeSet): void {
    this.runtimes = runtimes;

    runtimes.turnInterruptRuntime = createTurnInterruptRuntime(this.deps);

    runtimes.turnSideQuestionHelperRuntime =
      createTurnSideQuestionHelperRuntime(this.deps, (addressState, strategy) =>
        buildAddressPromptForState(this.deps, addressState, strategy),
      );

    runtimes.turnSideQuestionRoutingRuntime =
      new VoiceTurnSideQuestionRoutingRuntime({
        replyWithSideQuestionAndContinue: (params) =>
          this.runtimes.turnSideQuestionHelperRuntime.replyWithSideQuestionAndContinue(
            params,
          ),
        getVoiceIssueCandidate: (collectedData) =>
          this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(
            collectedData,
          ),
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
          this.runtimes.turnHandoffRuntime.replyWithSmsHandoff(params),
        replyWithIssueCaptureRecovery: (params) =>
          replyWithIssueCaptureRecovery(this.runtimes, params),
        replyWithTwiml: (res, twiml) =>
          this.deps.voiceResponseService.replyWithTwiml(res, twiml),
        buildSayGatherTwiml: (message) =>
          this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      });

    runtimes.turnIssueRecoveryRuntime = new VoiceTurnIssueRecoveryRuntime({
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
        this.deps.voiceTurnOrchestration.updateVoiceIssueCandidate(params),
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
        this.runtimes.turnHandoffRuntime.replyWithSmsHandoff(params),
      log: (payload, context) => this.deps.loggingService.log(payload, context),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      applyCsrStrategy: (strategy, message) =>
        applyCsrStrategy(this.deps, strategy, message),
      replyWithTwiml: (res, twiml) =>
        this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      loggerContext: LOGGER_CONTEXT,
    });

    runtimes.turnHandoffRuntime = new VoiceTurnHandoffRuntime({
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
        this.voiceIntakeSmsService.sendVoiceHandoffIntakeLink(params),
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
        applyCsrStrategy(this.deps, strategy, message),
      replyWithTwiml: (res, twiml) =>
        this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      log: (payload) => this.deps.loggingService.log(payload, LOGGER_CONTEXT),
      warn: (payload) => this.deps.loggingService.warn(payload, LOGGER_CONTEXT),
    });

    runtimes.turnAiTriageRuntime = new VoiceTurnAiTriageRuntime({
      getVoiceIssueCandidate: (collectedData) =>
        this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData),
      clearIssuePromptAttempts: (callSid) =>
        this.deps.voiceResponseService.clearIssuePromptAttempts(callSid),
      normalizeIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.normalizeIssueCandidate(value),
      isLikelyIssueCandidate: (value) =>
        this.deps.voiceTurnPolicyService.isLikelyIssueCandidate(value),
      updateVoiceIssueCandidate: (params) =>
        this.deps.voiceTurnOrchestration.updateVoiceIssueCandidate(params),
      replyWithIssueCaptureRecovery: (params) =>
        replyWithIssueCaptureRecovery(this.runtimes, params),
      isIssueRepeatComplaint: (value) =>
        this.deps.voiceTurnPolicyService.isIssueRepeatComplaint(value),
      triage: (params) =>
        trackAiCall(params.timingCollector, () =>
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
        this.deps.voiceSmsHandoffService.buildSmsHandoffMessage(
          callerFirstName,
        ),
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
        this.runtimes.turnHandoffRuntime.replyWithSmsHandoff(params),
      normalizeConfirmationUtterance: (value) =>
        normalizeConfirmationUtterance(value),
      replyWithTwiml: (res, twiml) =>
        this.deps.voiceResponseService.replyWithTwiml(res, twiml),
      buildSayGatherTwiml: (message) =>
        this.deps.voicePromptComposer.buildSayGatherTwiml(message),
      isHumanFallbackMessage: (message) =>
        this.runtimes.turnHandoffRuntime.isHumanFallbackMessage(message),
      replyWithHumanFallback: (params) =>
        this.deps.voiceResponseService.replyWithHumanFallback(params),
      isLikelyQuestion: (transcript) =>
        this.deps.voiceUtteranceService.isLikelyQuestion(transcript),
      isBookingIntent: (transcript) =>
        this.deps.voiceUtteranceService.isBookingIntent(transcript),
      replyWithBookingOffer: (params) =>
        replyWithBookingOffer(this.runtimes, params),
      logVoiceOutcome: (params) =>
        this.runtimes.turnHandoffRuntime.logVoiceOutcome(params),
      buildTwiml: (message) =>
        this.deps.voicePromptComposer.buildTwiml(message),
      replyWithNoHandoff: (params) =>
        this.deps.voiceResponseService.replyWithNoHandoff(params),
      warn: (payload, context) =>
        this.deps.loggingService.warn(payload, context),
      loggerContext: LOGGER_CONTEXT,
    });

    runtimes.turnSideQuestionRuntime = new VoiceTurnSideQuestionRuntime({
      resolveBinaryUtterance: (transcript) =>
        this.deps.voiceUtteranceService.resolveBinaryUtterance(transcript),
      isFrustrationRequest: (transcript) =>
        this.deps.voiceUtteranceService.isFrustrationRequest(transcript),
      clearVoiceListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.clearVoiceListeningWindow(params),
      replyWithSideQuestionAndContinue: (params) =>
        this.runtimes.turnSideQuestionHelperRuntime.replyWithSideQuestionAndContinue(
          params,
        ),
      getVoiceIssueCandidate: (collectedData) =>
        this.deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData),
      buildAskNameTwiml: (strategy) =>
        this.deps.voicePromptComposer.buildAskNameTwiml(strategy),
      prependPrefaceToGatherTwiml: (preface, twiml) =>
        this.deps.voicePromptComposer.prependPrefaceToGatherTwiml(
          preface,
          twiml,
        ),
      replyWithListeningWindow: (params) =>
        this.deps.voiceListeningWindowService.replyWithListeningWindow(params),
      buildAddressPromptForState: (addressState, strategy) =>
        buildAddressPromptForState(this.deps, addressState, strategy),
      replyWithIssueCaptureRecovery: (params) =>
        replyWithIssueCaptureRecovery(this.runtimes, params),
      continueAfterSideQuestionWithIssueRouting: (params) =>
        continueAfterSideQuestionWithIssueRouting(this.runtimes, params),
      buildSideQuestionReply: (tenantId, transcript) =>
        this.runtimes.turnSideQuestionHelperRuntime.buildSideQuestionReply(
          tenantId,
          transcript,
        ),
      updateVoiceUrgencyConfirmation: (params) =>
        this.deps.voiceTurnOrchestration.updateVoiceUrgencyConfirmation(
          params,
        ),
      buildUrgencyConfirmTwiml: (strategy, context) =>
        buildUrgencyConfirmTwiml(this.deps, strategy, context),
      getVoiceNameCandidate: (nameState) =>
        this.deps.voiceTurnPolicyService.getVoiceNameCandidate(nameState),
    });
  }
}
