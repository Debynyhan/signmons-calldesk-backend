import { Inject, Injectable } from "@nestjs/common";
import type { Response } from "express";
import {
  CommunicationChannel,
  Prisma,
  TenantOrganization,
} from "@prisma/client";
import appConfig, { type AppConfig } from "../config/app.config";
import { ConversationsService } from "../conversations/conversations.service";
import { CsrStrategy } from "./csr-strategy.selector";
import {
  extractNameCandidateDeterministic,
  isLikelyNameCandidate,
  isValidNameCandidate,
} from "./intake/voice-name-candidate.policy";
import * as voiceAddressCandidatePolicy from "./intake/voice-address-candidate.policy";
import {
  buildVoiceFallbackIssueCandidate,
  buildVoiceIssueAcknowledgement,
  isLikelyVoiceIssueCandidate,
  isVoiceComfortRiskRelevant,
  isVoiceIssueRepeatComplaint,
  normalizeVoiceIssueCandidate,
} from "./intake/voice-issue-candidate.policy";
import { reduceVoiceTurnPlanner } from "./intake/voice-turn-planner.reducer";
import {
  getRequestContext,
  setRequestContextData,
} from "../common/context/request-context";
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
import { VoiceTurnRuntimeFactory } from "./voice-turn-runtime.factory";

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
  private readonly turnHandoffRuntime: VoiceTurnHandoffRuntime;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly dependencies: VoiceTurnDependencies,
    runtimeFactory: VoiceTurnRuntimeFactory,
  ) {
    const r = runtimeFactory.build();
    this.turnPreludeRuntime = r.turnPreludeRuntime;
    this.turnContextRuntime = r.turnContextRuntime;
    this.turnEarlyRoutingRuntime = r.turnEarlyRoutingRuntime;
    this.turnExpectedFieldRuntime = r.turnExpectedFieldRuntime;
    this.turnIssueRecoveryRuntime = r.turnIssueRecoveryRuntime;
    this.turnInterruptRuntime = r.turnInterruptRuntime;
    this.turnAiTriageRuntime = r.turnAiTriageRuntime;
    this.turnNameOpeningRuntime = r.turnNameOpeningRuntime;
    this.turnNameCaptureRuntime = r.turnNameCaptureRuntime;
    this.turnNameFlowRuntime = r.turnNameFlowRuntime;
    this.turnNameSpellingRuntime = r.turnNameSpellingRuntime;
    this.turnAddressExtractionRuntime = r.turnAddressExtractionRuntime;
    this.turnAddressRoutingRuntime = r.turnAddressRoutingRuntime;
    this.turnAddressCompletenessRuntime = r.turnAddressCompletenessRuntime;
    this.turnAddressConfirmedRuntime = r.turnAddressConfirmedRuntime;
    this.turnAddressExistingCandidateRuntime = r.turnAddressExistingCandidateRuntime;
    this.turnSideQuestionHelperRuntime = r.turnSideQuestionHelperRuntime;
    this.turnSideQuestionRoutingRuntime = r.turnSideQuestionRoutingRuntime;
    this.turnSideQuestionRuntime = r.turnSideQuestionRuntime;
    this.turnHandoffRuntime = r.turnHandoffRuntime;
  }

  private get tenantsService() {
    return this.dependencies.tenantsService;
  }

  private get conversationsService() {
    return this.dependencies.conversationsService;
  }

  private get voiceConversationStateService() {
    return this.dependencies.voiceConversationStateService;
  }

  private get callLogService() {
    return this.dependencies.callLogService;
  }

  private get aiService() {
    return this.dependencies.aiService;
  }

  private get loggingService() {
    return this.dependencies.loggingService;
  }

  private get sanitizationService() {
    return this.dependencies.sanitizationService;
  }

  private get csrStrategySelector() {
    return this.dependencies.csrStrategySelector;
  }

  private get voicePromptComposer() {
    return this.dependencies.voicePromptComposer;
  }

  private get voiceHandoffPolicy() {
    return this.dependencies.voiceHandoffPolicy;
  }

  private get voiceSmsHandoffService() {
    return this.dependencies.voiceSmsHandoffService;
  }

  private get voiceSmsPhoneSlotService() {
    return this.dependencies.voiceSmsPhoneSlotService;
  }

  private get voiceTurnPolicyService() {
    return this.dependencies.voiceTurnPolicyService;
  }

  private get voiceUtteranceService() {
    return this.dependencies.voiceUtteranceService;
  }

  private get voiceUrgencySlotService() {
    return this.dependencies.voiceUrgencySlotService;
  }

  private get paymentsService() {
    return this.dependencies.paymentsService;
  }

  private get voiceAddressPromptService() {
    return this.dependencies.voiceAddressPromptService;
  }

  private get voiceResponseService() {
    return this.dependencies.voiceResponseService;
  }

  private get voiceListeningWindowService() {
    return this.dependencies.voiceListeningWindowService;
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

    const existingIssueCandidate =
      this.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData);
    const issueCandidate =
      this.voiceTurnPolicyService.normalizeIssueCandidate(normalizedSpeech);
    const hasIssueCandidate =
      this.voiceTurnPolicyService.isLikelyIssueCandidate(issueCandidate);
    // Set by multi-slot opening capture below; used to personalize the first address ask.
    let openingAddressPreface: string | null = null;
    if (existingIssueCandidate?.value || hasIssueCandidate) {
      this.voiceResponseService.clearIssuePromptAttempts(callSid);
    }
    if (hasIssueCandidate && !existingIssueCandidate?.value) {
      await this.voiceConversationStateService.updateVoiceIssueCandidate({
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
          await this.voiceConversationStateService.updateVoiceNameState({
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
          ? this.voiceTurnPolicyService.buildIssueAcknowledgement(issueCandidate)
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
      this.voiceTurnPolicyService.isLikelyAddressInputForName(normalizedSpeech)
    ) {
      expectedField = "address";
    }
    const yesNoIntent =
      this.voiceUtteranceService.resolveBinaryUtterance(normalizedSpeech);
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
    const emergencyRelevant = this.voiceTurnPolicyService.isComfortRiskRelevant(
      existingIssueCandidate?.value ??
        (hasIssueCandidate ? issueCandidate : ""),
    );
    const isQuestionUtterance =
      this.voiceUtteranceService.isLikelyQuestion(normalizedSpeech);
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
        ? this.voiceTurnPolicyService.buildIssueAcknowledgement(
            existingIssueCandidate.value,
          )
        : null;
      const bookingIntent =
        this.voiceUtteranceService.isBookingIntent(normalizedSpeech);
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
        buildSpellNameTwiml: () =>
          this.voicePromptComposer.buildSpellNameTwiml(csrStrategy),
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
        buildSpellNameTwiml: () =>
          this.voicePromptComposer.buildSpellNameTwiml(csrStrategy),
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
      await this.voiceListeningWindowService.clearVoiceListeningWindow({
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

}
