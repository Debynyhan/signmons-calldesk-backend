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
import { PaymentsService } from "../payments/payments.service";
import {
  buildIssueSlotPrompt,
  ISSUE_SLOT_SMS_DEFER_MESSAGE,
} from "./intake/issue-slot.policy";
import { reduceIssueSlot } from "./intake/voice-intake.reducer";
import { reduceVoiceTurnPlanner } from "./intake/voice-turn-planner.reducer";
import {
  getRequestContext,
  setRequestContextData,
} from "../common/context/request-context";

type ConfirmationOutcome =
  | "CONFIRM"
  | "REJECT"
  | "REPLACE_CANDIDATE"
  | "UNKNOWN";

type ConfirmationResolution = {
  outcome: ConfirmationOutcome;
  candidate: string | null;
};
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
    private readonly paymentsService: PaymentsService,
  ) {}

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

    const conversation =
      await this.conversationsService.getVoiceConversationByCallSid({
        tenantId: tenant.id,
        callSid,
      });
    const consentGranted = Boolean(
      (conversation?.collectedData as { voiceConsent?: { granted?: boolean } })
        ?.voiceConsent?.granted,
    );
    if (!consentGranted) {
      return this.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        callSid,
        reason: "consent_missing",
      });
    }

    if (!conversation) {
      return this.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        callSid,
        reason: "conversation_missing",
      });
    }

    const now = new Date();
    const speechResult = params.speechResult ?? null;
    const normalizedSpeech = speechResult
      ? speechResult.replace(/\s+/g, " ").trim()
      : "";
    if (!normalizedSpeech) {
      return res ? this.replyWithTwiml(res, this.buildRepromptTwiml()) : "";
    }
    const collectedDataSnapshot = conversation.collectedData ?? null;
    const listeningWindowSnapshot = this.getVoiceListeningWindow(
      collectedDataSnapshot,
    );
    const expectedFieldSnapshot = this.getExpectedListeningField(
      listeningWindowSnapshot,
    );
    if (
      !res &&
      this.shouldIgnoreStreamingTranscript(
        normalizedSpeech,
        collectedDataSnapshot,
        expectedFieldSnapshot,
      )
    ) {
      return "";
    }
    if (
      !res &&
      this.isDuplicateTranscript(
        conversation?.collectedData,
        normalizedSpeech,
        now,
      )
    ) {
      return "";
    }

    const turnState = await this.conversationsService.incrementVoiceTurn({
      tenantId: tenant.id,
      conversationId: conversation.id,
      now,
    });

    if (!turnState) {
      return this.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        conversationId: conversation.id,
        callSid,
        reason: "turn_state_missing",
      });
    }

    const voiceTurnCount = turnState.voiceTurnCount;
    const maxTurns = Math.max(1, this.config.voiceMaxTurns ?? 6);
    const maxDurationSec = Math.max(30, this.config.voiceMaxDurationSec ?? 180);
    const startedAt = new Date(turnState.voiceStartedAt);
    const elapsedSec = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
    const displayName = this.getTenantDisplayName(tenant);
    if (turnState.voiceTurnCount > maxTurns || elapsedSec > maxDurationSec) {
      return this.replyWithHumanFallback({
        res,
        tenantId: tenant.id,
        conversationId: conversation.id,
        callSid,
        displayName,
        reason:
          turnState.voiceTurnCount > maxTurns
            ? "max_turns_exceeded"
            : "max_duration_exceeded",
      });
    }
    if (
      this.isDuplicateTranscript(
        conversation?.collectedData,
        normalizedSpeech,
        now,
      )
    ) {
      return this.replyWithTwiml(
        res,
        this.buildSayGatherTwiml("Thanks, I heard that. Please continue."),
      );
    }
    const confidence = this.normalizeConfidence(params.confidence ?? null);
    const updatedConversation =
      await this.conversationsService.updateVoiceTranscript({
        tenantId: tenant.id,
        callSid,
        transcript: normalizedSpeech,
        confidence,
      });
    let transcriptEventId: string | null = null;
    if (updatedConversation) {
      // Text only, no audio blobs.
      transcriptEventId = await this.callLogService.createVoiceTranscriptLog({
        tenantId: tenant.id,
        conversationId: updatedConversation.id,
        callSid,
        transcript: normalizedSpeech,
        confidence,
        occurredAt: new Date(),
      });
    }
    const conversationId = updatedConversation?.id ?? conversation?.id;
    if (!conversationId) {
      return this.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        callSid,
        reason: "conversation_id_missing",
      });
    }
    if (!transcriptEventId) {
      return this.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        reason: "transcript_event_missing",
      });
    }

    const collectedData =
      updatedConversation?.collectedData ?? conversation.collectedData;
    let nameState =
      this.conversationsService.getVoiceNameState(collectedData);
    const phoneState =
      this.conversationsService.getVoiceSmsPhoneState(collectedData);
    const addressState =
      this.conversationsService.getVoiceAddressState(collectedData);
    const rawCsrStrategy = this.selectCsrStrategy({
      conversation: updatedConversation ?? conversation,
      collectedData,
      nameState,
      addressState,
    });
    const csrStrategy = this.normalizeCsrStrategyForTurn(
      rawCsrStrategy,
      voiceTurnCount,
    );
    this.loggingService.log(
      {
        event: "voice.strategy_selected",
        tenantId: tenant.id,
        conversationId,
        strategy: csrStrategy ?? "NONE",
        rawStrategy: rawCsrStrategy,
        fsmState:
          updatedConversation?.currentFSMState ??
          conversation.currentFSMState ??
          null,
      },
      VoiceTurnService.name,
    );
    const currentEventId = transcriptEventId;
    const requestId = params.requestId;
    setRequestContextData({
      tenantId: tenant.id,
      requestId,
      callSid,
      conversationId,
      channel: "VOICE",
      sourceEventId: currentEventId ?? undefined,
    });
    let listeningWindow = this.getVoiceListeningWindow(collectedData);
    if (
      listeningWindow &&
      this.shouldClearListeningWindow(
        listeningWindow,
        now,
        nameState,
        addressState,
        phoneState,
      )
    ) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      listeningWindow = null;
    }
    const lastEventId = this.getVoiceLastEventId(collectedData);
    if (lastEventId && lastEventId === currentEventId) {
      return this.replyWithTwiml(
        res,
        this.buildListeningWindowReprompt({
          window: listeningWindow,
          nameState,
          addressState,
          phoneState,
          strategy: csrStrategy,
        }),
      );
    }
    await this.markVoiceEventProcessed({
      tenantId: tenant.id,
      conversationId,
      eventId: currentEventId,
    });
    let expectedField = this.getExpectedListeningField(listeningWindow);
    let nameReady =
      Boolean(nameState.confirmed.value) ||
      this.isVoiceFieldReady(nameState.locked, nameState.confirmed.value);
    const addressDeferred = Boolean(addressState.smsConfirmNeeded);
    const addressReady =
      Boolean(addressState.confirmed) ||
      this.isVoiceFieldReady(addressState.locked, addressState.confirmed) ||
      addressDeferred;
    if (expectedField === "name" && nameReady) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      expectedField = null;
    }
    if (
      expectedField === "address" &&
      !nameReady &&
      nameState.attemptCount === 0
    ) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      expectedField = null;
    }
    if (expectedField === "booking") {
      const binaryIntent = this.resolveBinaryUtterance(normalizedSpeech);
      const isYes =
        binaryIntent === "YES" ||
        this.isBookingIntent(normalizedSpeech);
      const isNo = binaryIntent === "NO";
      if (isYes) {
        await this.clearVoiceListeningWindow({
          tenantId: tenant.id,
          conversationId,
        });
        expectedField = null;
      } else if (isNo) {
        await this.clearVoiceListeningWindow({
          tenantId: tenant.id,
          conversationId,
        });
        return this.replyWithTwiml(
          res,
          this.buildSayGatherTwiml(
            "No problem. Do you have any other questions?",
          ),
        );
      } else {
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "confirmation",
          targetField: "booking",
          sourceEventId: currentEventId,
          twiml: this.buildBookingPromptTwiml(csrStrategy),
        });
      }
    }
    if (expectedField === "callback") {
      const binaryIntent = this.resolveBinaryUtterance(normalizedSpeech);
      const isYes = binaryIntent === "YES";
      const isNo = binaryIntent === "NO";
      if (isYes) {
        await this.clearVoiceListeningWindow({
          tenantId: tenant.id,
          conversationId,
        });
        return this.replyWithHumanFallback({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          reason: "callback_requested",
          messageOverride: "We'll call you back shortly.",
        });
      }
      if (isNo) {
        await this.clearVoiceListeningWindow({
          tenantId: tenant.id,
          conversationId,
        });
        return this.replyWithTwiml(
          res,
          this.buildSayGatherTwiml(
            "No problem. I can keep helping here. How can I help?",
          ),
        );
      }
      return this.replyWithListeningWindow({
        res,
        tenantId: tenant.id,
        conversationId,
        field: "confirmation",
        targetField: "callback",
        sourceEventId: currentEventId,
        twiml: this.buildCallbackOfferTwiml(csrStrategy),
      });
    }
    if (expectedField === "comfort_risk") {
      const binaryIntent = this.resolveBinaryUtterance(normalizedSpeech);
      const isYes = binaryIntent === "YES";
      const isNo = binaryIntent === "NO";
      if (isYes || isNo) {
        await this.conversationsService.updateVoiceUrgencyConfirmation({
          tenantId: tenant.id,
          conversationId,
          urgencyConfirmation: {
            askedAt: new Date().toISOString(),
            response: isYes ? "YES" : "NO",
            sourceEventId: currentEventId ?? null,
          },
        });
        await this.clearVoiceListeningWindow({
          tenantId: tenant.id,
          conversationId,
        });
        const preface = isYes
          ? "Thanks. We'll treat this as urgent."
          : "Okay, we'll keep it standard.";
        return this.continueAfterSideQuestionWithIssueRouting({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          sideQuestionReply: preface,
          expectedField: null,
          nameReady,
          addressReady,
          nameState,
          addressState,
          collectedData,
          currentEventId,
          strategy: csrStrategy,
          timingCollector,
        });
      }
      return this.replyWithListeningWindow({
        res,
        tenantId: tenant.id,
        conversationId,
        field: "confirmation",
        targetField: "urgency_confirm",
        sourceEventId: currentEventId,
        twiml: this.buildUrgencyConfirmTwiml(csrStrategy),
      });
    }
    if (expectedField === "urgency_confirm") {
      const binaryIntent = this.resolveBinaryUtterance(normalizedSpeech);
      const isYes = binaryIntent === "YES";
      const isNo = binaryIntent === "NO";
      if (isYes || isNo) {
        await this.conversationsService.updateVoiceUrgencyConfirmation({
          tenantId: tenant.id,
          conversationId,
          urgencyConfirmation: {
            askedAt: new Date().toISOString(),
            response: isYes ? "YES" : "NO",
            sourceEventId: currentEventId ?? null,
          },
        });
        await this.clearVoiceListeningWindow({
          tenantId: tenant.id,
          conversationId,
        });
        const preface = isYes
          ? "Thanks. We'll treat this as urgent."
          : "Okay, we'll keep it standard.";
        return this.continueAfterSideQuestionWithIssueRouting({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          sideQuestionReply: preface,
          expectedField: null,
          nameReady,
          addressReady,
          nameState,
          addressState,
          collectedData,
          currentEventId,
          strategy: csrStrategy,
          timingCollector,
        });
      }
      return this.replyWithListeningWindow({
        res,
        tenantId: tenant.id,
        conversationId,
        field: "confirmation",
        targetField: "urgency_confirm",
        sourceEventId: currentEventId,
        twiml: this.buildUrgencyConfirmTwiml(csrStrategy),
      });
    }
    if (this.isSlowDownRequest(normalizedSpeech)) {
      if (expectedField === "name") {
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml: this.buildTakeYourTimeTwiml("name", csrStrategy),
        });
      }
      if (expectedField === "address") {
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "address",
          sourceEventId: currentEventId,
          twiml: this.buildTakeYourTimeTwiml("address", csrStrategy),
        });
      }
      if (expectedField === "sms_phone") {
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "sms_phone",
          sourceEventId: currentEventId,
          twiml: this.buildTakeYourTimeTwiml("sms_phone", csrStrategy),
        });
      }
      return this.replyWithTwiml(
        res,
        this.buildSayGatherTwiml("Sure—take your time. How can I help?"),
      );
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
      const deterministicNameCandidate =
        this.extractNameCandidateDeterministic(normalizedSpeech);
      const hasDeterministicName =
        deterministicNameCandidate &&
        this.isValidNameCandidate(deterministicNameCandidate) &&
        this.isLikelyNameCandidate(deterministicNameCandidate);
      if (hasDeterministicName && deterministicNameCandidate) {
        const currentName = nameState.candidate.value?.trim().toLowerCase() ?? "";
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
        Boolean(this.extractAddressLocalityCorrection(normalizedSpeech)))
    ) {
      expectedField = "address";
    }
    const urgencyConfirmation =
      this.conversationsService.getVoiceUrgencyConfirmation(collectedData);
    const emergencyIssueContext =
      existingIssueCandidate?.value ?? (hasIssueCandidate ? issueCandidate : "");
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
        issueCaptured: Boolean(existingIssueCandidate?.value || hasIssueCandidate),
        emergencyRelevant,
        emergencyAsked: Boolean(urgencyConfirmation.askedAt),
        emergencyAnswered: Boolean(urgencyConfirmation.response),
      },
      {
        isQuestion: isQuestionUtterance,
      },
    );
    const shouldAskUrgencyConfirm = turnPlan.type === "ASK_EMERGENCY";
    const isYesNoUtterance = Boolean(yesNoIntent);
    const shouldHandleLateUrgencyConfirmation =
      !expectedField &&
      isYesNoUtterance &&
      !urgencyConfirmation.response &&
      Boolean(urgencyConfirmation.askedAt);

    if (shouldHandleLateUrgencyConfirmation) {
      const isYes = yesNoIntent === "YES";
      await this.conversationsService.updateVoiceUrgencyConfirmation({
        tenantId: tenant.id,
        conversationId,
        urgencyConfirmation: {
          askedAt: new Date().toISOString(),
          response: isYes ? "YES" : "NO",
          sourceEventId: currentEventId ?? null,
        },
      });
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      const preface = isYes
        ? "Thanks. We'll treat this as urgent."
        : "Okay, we'll keep it standard.";
      return this.continueAfterSideQuestionWithIssueRouting({
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        displayName,
        sideQuestionReply: preface,
        expectedField: null,
        nameReady,
        addressReady,
        nameState,
        addressState,
        collectedData,
        currentEventId,
        strategy: csrStrategy,
        timingCollector,
      });
    }

    if (this.isHangupRequest(normalizedSpeech)) {
      this.clearIssuePromptAttempts(callSid);
      return this.replyWithTwiml(
        res,
        this.buildTwiml(
          "No problem. If you need anything later, call us back.",
        ),
      );
    }

    if (this.isHumanTransferRequest(normalizedSpeech)) {
      return this.replyWithListeningWindow({
        res,
        tenantId: tenant.id,
        conversationId,
        field: "confirmation",
        targetField: "callback",
        sourceEventId: currentEventId,
        twiml: this.buildCallbackOfferTwiml(csrStrategy),
      });
    }
    if (this.isSmsDifferentNumberRequest(normalizedSpeech)) {
      await this.conversationsService.updateVoiceSmsHandoff({
        tenantId: tenant.id,
        conversationId,
        handoff: {
          reason: "sms_number_change_requested",
          messageOverride: null,
          createdAt: new Date().toISOString(),
        },
      });
      await this.conversationsService.updateVoiceSmsPhoneState({
        tenantId: tenant.id,
        conversationId,
        phoneState: {
          ...phoneState,
          confirmed: false,
          confirmedAt: null,
          attemptCount: 0,
          lastPromptedAt: new Date().toISOString(),
        },
      });
      return this.replyWithListeningWindow({
        res,
        tenantId: tenant.id,
        conversationId,
        field: "sms_phone",
        sourceEventId: currentEventId,
        twiml: this.buildAskSmsNumberTwiml(csrStrategy),
      });
    }

    if (this.isFrustrationRequest(normalizedSpeech)) {
      const apologyReply = await this.replyWithSideQuestionAndContinue({
        res,
        tenantId: tenant.id,
        conversationId,
        sideQuestionReply: "Sorry about that.",
        expectedField,
        nameReady,
        addressReady,
        addressState,
        currentEventId,
        strategy: csrStrategy,
      });
      if (apologyReply) {
        return apologyReply;
      }
      const issueForFrustration = this.getVoiceIssueCandidate(collectedData);
      if (!nameReady) {
        const baseTwiml = this.buildAskNameTwiml(csrStrategy);
        const twiml = this.prependPrefaceToGatherTwiml(
          "Sorry about that.",
          baseTwiml,
        );
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml,
        });
      }
      if (!addressReady) {
        const baseTwiml = this.buildAddressPromptForState(
          addressState,
          csrStrategy,
        );
        const twiml = this.prependPrefaceToGatherTwiml(
          "Sorry about that.",
          baseTwiml,
        );
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "address",
          sourceEventId: currentEventId,
          twiml,
        });
      }
      if (!issueForFrustration?.value && nameReady && addressReady) {
        return this.replyWithIssueCaptureRecovery({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          nameState,
          addressState,
          collectedData,
          strategy: csrStrategy,
          reason: "frustration_missing_issue",
          promptPrefix: "I hear you, and I'm sorry for the repeat.",
          transcript: normalizedSpeech,
        });
      }
      return this.continueAfterSideQuestionWithIssueRouting({
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        displayName,
        sideQuestionReply: "I hear you.",
        expectedField: null,
        nameReady,
        addressReady,
        nameState,
        addressState,
        collectedData,
        currentEventId,
        strategy: csrStrategy,
        timingCollector,
      });
    }

    const sideQuestionReply = await this.buildSideQuestionReply(
      tenant.id,
      normalizedSpeech,
    );
    if (sideQuestionReply) {
      if (shouldAskUrgencyConfirm) {
        await this.conversationsService.updateVoiceUrgencyConfirmation({
          tenantId: tenant.id,
          conversationId,
          urgencyConfirmation: {
            askedAt: new Date().toISOString(),
            response: null,
            sourceEventId: currentEventId ?? null,
          },
        });
        const baseTwiml = this.buildUrgencyConfirmTwiml(csrStrategy, {
          callerName: this.getVoiceNameCandidate(nameState),
          issueCandidate: emergencyIssueContext,
        });
        const twiml = this.prependPrefaceToGatherTwiml(
          sideQuestionReply,
          baseTwiml,
        );
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "confirmation",
          targetField: "urgency_confirm",
          sourceEventId: currentEventId,
          twiml,
        });
      }
      const earlyReply = await this.replyWithSideQuestionAndContinue({
        res,
        tenantId: tenant.id,
        conversationId,
        sideQuestionReply,
        expectedField,
        nameReady,
        addressReady,
        addressState,
        currentEventId,
        strategy: csrStrategy,
      });
      if (earlyReply) {
        return earlyReply;
      }
    }
    if (shouldAskUrgencyConfirm) {
      await this.conversationsService.updateVoiceUrgencyConfirmation({
        tenantId: tenant.id,
        conversationId,
        urgencyConfirmation: {
          askedAt: new Date().toISOString(),
          response: null,
          sourceEventId: currentEventId ?? null,
        },
      });
      return this.replyWithListeningWindow({
        res,
        tenantId: tenant.id,
        conversationId,
        field: "confirmation",
        targetField: "urgency_confirm",
        sourceEventId: currentEventId,
        twiml: this.buildUrgencyConfirmTwiml(csrStrategy, {
          callerName: this.getVoiceNameCandidate(nameState),
          issueCandidate: emergencyIssueContext,
        }),
      });
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
      const buildAddressPrompt = (preface?: string) => {
        const base = "Please say the service address.";
        if (preface && preface.trim()) {
          return this.applyCsrStrategy(
            csrStrategy,
            `${preface.trim()} ${base}`,
          );
        }
        return this.applyCsrStrategy(csrStrategy, base);
      };
      const turnIndex = voiceTurnCount;
      let workingNameState: typeof nameState = nameState;
      const lockNameForAddressProgression = async () => {
        if (workingNameState.locked) {
          return;
        }
        const fallbackTimestamp = new Date().toISOString();
        const nextNameState: typeof nameState = {
          ...workingNameState,
          status: workingNameState.candidate.value ? "CANDIDATE" : "MISSING",
          locked: true,
          attemptCount: Math.max(1, workingNameState.attemptCount),
          candidate: {
            value: workingNameState.candidate.value,
            sourceEventId:
              workingNameState.candidate.sourceEventId ?? currentEventId,
            createdAt:
              workingNameState.candidate.createdAt ?? fallbackTimestamp,
          },
        };
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: nextNameState,
        });
        workingNameState = nextNameState;
      };
      const repromptLowConfidenceNameForAddress = async () => {
        const candidate = workingNameState.candidate.value;
        if (
          !this.shouldRepromptForLowConfidenceName(workingNameState, candidate)
        ) {
          return null;
        }
        const nextNameState: typeof nameState = {
          ...workingNameState,
          status: candidate ? "CANDIDATE" : "MISSING",
          locked: false,
          spellPromptedAt: Date.now(),
          spellPromptedTurnIndex: turnIndex,
          spellPromptCount: (workingNameState.spellPromptCount ?? 0) + 1,
        };
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: nextNameState,
        });
        workingNameState = nextNameState;
        this.loggingService.log(
          {
            event: "nameCapture.lowConfidenceReprompt",
            tenantId: tenant.id,
            conversationId,
            callSid,
            candidate,
            confidence: workingNameState.lastConfidence ?? null,
            turnIndex,
          },
          VoiceTurnService.name,
        );
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml: this.buildSayGatherTwiml(
            this.applyCsrStrategy(
              csrStrategy,
              this.buildNameClarificationPrompt(candidate),
            ),
          ),
        });
      };
      const replyWithAddressPrompt = async (preface?: string) => {
        const clarification = await repromptLowConfidenceNameForAddress();
        if (clarification) {
          return clarification;
        }
        await lockNameForAddressProgression();
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "address",
          sourceEventId: currentEventId,
          timeoutSec: 8,
          twiml: this.buildSayGatherTwiml(buildAddressPrompt(preface), {
            timeout: 8,
          }),
        });
      };
      const recordNameAttemptIfNeeded = async () => {
        if (workingNameState.attemptCount > 0) {
          return;
        }
        const nextNameState: typeof nameState = {
          ...workingNameState,
          attemptCount: 1,
        };
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: nextNameState,
        });
        workingNameState = nextNameState;
      };
      const replyWithNameTwiml = async (twiml: string) => {
        await recordNameAttemptIfNeeded();
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml,
        });
      };
      const storeProvisionalName = async (
        candidate: string,
        options?: {
          lastConfidence?: number | null;
          corrections?: number;
          firstNameSpelled?: string | null;
          spellPromptedAt?: number | null;
          spellPromptedTurnIndex?: number | null;
          spellPromptCount?: number;
        },
      ) => {
        const baseNameState = workingNameState;
        const nextNameState: typeof nameState = {
          ...baseNameState,
          candidate: {
            value: candidate,
            sourceEventId: currentEventId,
            createdAt: new Date().toISOString(),
          },
          status: "CANDIDATE",
          attemptCount: Math.max(1, baseNameState.attemptCount),
          corrections:
            typeof options?.corrections === "number"
              ? options.corrections
              : (baseNameState.corrections ?? 0),
          lastConfidence:
            typeof options?.lastConfidence === "number"
              ? options.lastConfidence
              : (baseNameState.lastConfidence ?? null),
          firstNameSpelled:
            typeof options?.firstNameSpelled === "string"
              ? options.firstNameSpelled
              : (baseNameState.firstNameSpelled ?? null),
          spellPromptedAt:
            options && "spellPromptedAt" in options
              ? (options.spellPromptedAt ?? null)
              : (baseNameState.spellPromptedAt ?? null),
          spellPromptedTurnIndex:
            options && "spellPromptedTurnIndex" in options
              ? (options.spellPromptedTurnIndex ?? null)
              : (baseNameState.spellPromptedTurnIndex ?? null),
          spellPromptCount:
            typeof options?.spellPromptCount === "number"
              ? options.spellPromptCount
              : (baseNameState.spellPromptCount ?? 0),
        };
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: nextNameState,
        });
        workingNameState = nextNameState;
        return nextNameState;
      };
      const buildNameFollowUp = (issueSummary?: string | null) => {
        const trimmedIssue = issueSummary?.trim().replace(/[.?!]+$/, "") ?? "";
        const issueAck = trimmedIssue ? `I heard ${trimmedIssue}. ` : "";
        return `${issueAck}What's your full name?`.replace(/\s+/g, " ").trim();
      };
      const promptForNameSpelling = async (
        candidate: string,
        baseNameState: typeof nameState,
      ) => {
        const nextPromptCount = (baseNameState.spellPromptCount ?? 0) + 1;
        const promptState: typeof nameState = {
          ...baseNameState,
          spellPromptedAt: Date.now(),
          spellPromptedTurnIndex: turnIndex,
          spellPromptCount: nextPromptCount,
        };
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: promptState,
        });
        workingNameState = promptState;
        this.loggingService.log(
          {
            event: "nameCapture.spellPrompted",
            tenantId: tenant.id,
            conversationId,
            callSid,
            candidate,
            lastConfidence: promptState.lastConfidence ?? null,
            corrections: promptState.corrections ?? 0,
            turnIndex,
          },
          VoiceTurnService.name,
        );
        return replyWithNameTwiml(this.buildSpellNameTwiml(csrStrategy));
      };
      const maybePromptForSpelling = async (
        candidate: string,
        nextNameState: typeof nameState,
        issueSummary?: string | null,
      ) => {
        if (this.shouldPromptForNameSpelling(nextNameState, candidate)) {
          return promptForNameSpelling(candidate, nextNameState);
        }
        return acknowledgeNameAndMoveOn(candidate, issueSummary ?? null);
      };
      const acknowledgeNameAndMoveOn = async (
        candidate: string,
        issueSummary?: string | null,
      ) => {
        const firstName = candidate.split(" ").filter(Boolean)[0] ?? "";
        const thanks = firstName ? `Thanks, ${firstName}.` : "Thanks.";
        const resolvedIssue = issueSummary ?? existingIssueSummary ?? null;
        const trimmedIssue = resolvedIssue?.trim().replace(/[.?!]+$/, "") ?? "";
        const issueAck = trimmedIssue ? `I heard ${trimmedIssue}.` : "";
        const preface = issueAck ? `${thanks} ${issueAck}` : thanks;
        return replyWithAddressPrompt(preface);
      };
      const spellingResponseCandidate =
        this.normalizeNameCandidate(normalizedSpeech);
      const shouldHandleSpellingResponse =
        Boolean(workingNameState.spellPromptedAt) &&
        (typeof workingNameState.spellPromptedTurnIndex !== "number" ||
          turnIndex > workingNameState.spellPromptedTurnIndex ||
          (spellingResponseCandidate &&
            this.isValidNameCandidate(spellingResponseCandidate) &&
            this.isLikelyNameCandidate(spellingResponseCandidate)));

      if (shouldHandleSpellingResponse) {
        const parsed = this.parseSpelledNameParts(normalizedSpeech);
        if (parsed.firstName) {
          const candidate = parsed.lastName
            ? `${parsed.firstName} ${parsed.lastName}`
            : parsed.firstName;
          await storeProvisionalName(candidate, {
            lastConfidence: 0.95,
            corrections: nameState.corrections ?? 0,
            firstNameSpelled: parsed.firstName,
            spellPromptedAt: null,
            spellPromptedTurnIndex: null,
            spellPromptCount: nameState.spellPromptCount ?? 1,
          });
          this.loggingService.log(
            {
              event: "nameCapture.spellParsed",
              tenantId: tenant.id,
              conversationId,
              callSid,
              parsed: parsed.firstName,
              letterCount: parsed.letterCount,
              turnIndex,
            },
            VoiceTurnService.name,
          );
          return acknowledgeNameAndMoveOn(candidate);
        }
        if (parsed.reason === "no_letters") {
          const fallbackCandidate =
            this.extractNameCandidateDeterministic(normalizedSpeech) ??
            this.normalizeNameCandidate(normalizedSpeech);
          if (
            fallbackCandidate &&
            this.isValidNameCandidate(fallbackCandidate) &&
            this.isLikelyNameCandidate(fallbackCandidate)
          ) {
            await storeProvisionalName(fallbackCandidate, {
              lastConfidence: confidence ?? null,
              corrections: nameState.corrections ?? 0,
              spellPromptedAt: null,
              spellPromptedTurnIndex: null,
              spellPromptCount: nameState.spellPromptCount ?? 1,
            });
            return acknowledgeNameAndMoveOn(fallbackCandidate);
          }
        }
        this.loggingService.log(
          {
            event: "nameCapture.spellParseFailed",
            tenantId: tenant.id,
            conversationId,
            callSid,
            reason: parsed.reason ?? "unknown",
            letterCount: parsed.letterCount,
            turnIndex,
          },
          VoiceTurnService.name,
        );
        const promptCount = nameState.spellPromptCount ?? 0;
        if (promptCount < 2) {
          await this.conversationsService.updateVoiceNameState({
            tenantId: tenant.id,
            conversationId,
            nameState: {
              ...nameState,
              spellPromptedAt: Date.now(),
              spellPromptedTurnIndex: turnIndex,
              spellPromptCount: promptCount + 1,
            },
          });
          this.loggingService.log(
            {
              event: "nameCapture.spellPrompted",
              tenantId: tenant.id,
              conversationId,
              callSid,
              candidate: nameState.candidate.value ?? null,
              lastConfidence: nameState.lastConfidence ?? null,
              corrections: nameState.corrections ?? 0,
              turnIndex,
            },
            VoiceTurnService.name,
          );
          return replyWithNameTwiml(this.buildSpellNameTwiml(csrStrategy));
        }
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: {
            ...nameState,
            spellPromptedAt: null,
            spellPromptedTurnIndex: null,
          },
        });
        return replyWithAddressPrompt();
      }

      if (isOpeningTurn) {
        if (this.isOpeningGreetingOnly(normalizedSpeech)) {
          return replyWithNameTwiml(
            this.buildSayGatherTwiml(
              this.applyCsrStrategy(
                csrStrategy,
                "I'm here to help. Please say your full name and briefly what's going on with the system.",
              ),
            ),
          );
        }
        const openingCandidate =
          this.extractNameCandidateDeterministic(normalizedSpeech);
        const hasOpeningName =
          openingCandidate &&
          this.isValidNameCandidate(openingCandidate) &&
          this.isLikelyNameCandidate(openingCandidate);
        const issueCandidate = this.normalizeIssueCandidate(normalizedSpeech);
        const hasIssue = this.isLikelyIssueCandidate(issueCandidate);
        if (hasIssue) {
          this.clearIssuePromptAttempts(callSid);
          await this.conversationsService.updateVoiceIssueCandidate({
            tenantId: tenant.id,
            conversationId,
            issue: {
              value: issueCandidate,
              sourceEventId: currentEventId ?? "",
              createdAt: new Date().toISOString(),
            },
          });
          if (hasOpeningName && openingCandidate) {
            const issueSummary =
              this.buildIssueAcknowledgement(normalizedSpeech);
            const nextNameState = await storeProvisionalName(openingCandidate, {
              lastConfidence: confidence ?? null,
              corrections: nameState.corrections ?? 0,
            });
            return maybePromptForSpelling(
              openingCandidate,
              nextNameState,
              issueSummary,
            );
          }
          const followUp = buildNameFollowUp(
            this.buildIssueAcknowledgement(normalizedSpeech),
          );
          return replyWithNameTwiml(
            this.buildSayGatherTwiml(
              this.applyCsrStrategy(csrStrategy, followUp),
            ),
          );
        }
        if (hasOpeningName && openingCandidate) {
          const nextNameState = await storeProvisionalName(openingCandidate, {
            lastConfidence: confidence ?? null,
            corrections: nameState.corrections ?? 0,
          });
          return maybePromptForSpelling(openingCandidate, nextNameState);
        }
        const sideQuestionReply = await this.buildSideQuestionReply(
          tenant.id,
          normalizedSpeech,
        );
        if (sideQuestionReply && !bookingIntent) {
          return this.replyWithBookingOffer({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            sourceEventId: currentEventId,
            message: sideQuestionReply,
            strategy: csrStrategy,
          });
        }
        const followUp = sideQuestionReply
          ? `${sideQuestionReply} What's your full name?`
          : "What's your full name?";
        return replyWithNameTwiml(
          this.buildSayGatherTwiml(
            this.applyCsrStrategy(csrStrategy, followUp),
          ),
        );
      }

      const issueCandidate = this.normalizeIssueCandidate(normalizedSpeech);
      if (this.isLikelyIssueCandidate(issueCandidate)) {
        const existingIssue = this.getVoiceIssueCandidate(collectedData);
        if (!existingIssue?.value) {
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
        const followUp = buildNameFollowUp(
          this.buildIssueAcknowledgement(normalizedSpeech),
        );
        if (nameState.attemptCount >= 1) {
          await recordNameAttemptIfNeeded();
          return replyWithAddressPrompt();
        }
        return replyWithNameTwiml(
          this.buildSayGatherTwiml(
            this.applyCsrStrategy(csrStrategy, followUp),
          ),
        );
      }

      const sideQuestionReply = await this.buildSideQuestionReply(
        tenant.id,
        normalizedSpeech,
      );
      if (sideQuestionReply && !bookingIntent) {
        return this.replyWithBookingOffer({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          sourceEventId: currentEventId,
          message: sideQuestionReply,
          strategy: csrStrategy,
        });
      }

      const duplicateMissing =
        !nameState.candidate.value &&
        nameState.candidate.sourceEventId === currentEventId;
      if (duplicateMissing) {
        if (nameState.attemptCount >= 1) {
          await recordNameAttemptIfNeeded();
          return replyWithAddressPrompt();
        }
        return replyWithNameTwiml(this.buildAskNameTwiml(csrStrategy));
      }

      if (this.isLikelyAddressInputForName(normalizedSpeech)) {
        await recordNameAttemptIfNeeded();
        return replyWithAddressPrompt();
      }

      const deterministicCandidate =
        this.extractNameCandidateDeterministic(normalizedSpeech);
      const extracted =
        deterministicCandidate ??
        (await this.trackAiCall(timingCollector, () =>
          this.aiService.extractNameCandidate(tenant.id, normalizedSpeech),
        ));
      const candidateName = this.normalizeNameCandidate(extracted ?? "");
      const validatedCandidate =
        this.isValidNameCandidate(candidateName) &&
        this.isLikelyNameCandidate(candidateName)
          ? candidateName
          : "";
      if (validatedCandidate) {
        const existingCandidate = nameState.candidate.value;
        if (
          existingCandidate &&
          existingCandidate.trim().toLowerCase() ===
            validatedCandidate.trim().toLowerCase()
        ) {
          if (this.shouldPromptForNameSpelling(nameState, existingCandidate)) {
            return promptForNameSpelling(existingCandidate, nameState);
          }
          return acknowledgeNameAndMoveOn(existingCandidate);
        }
        const isCorrection =
          Boolean(existingCandidate) &&
          validatedCandidate !== existingCandidate;
        const nextCorrections = isCorrection
          ? (nameState.corrections ?? 0) + 1
          : (nameState.corrections ?? 0);
        const nextNameState = await storeProvisionalName(validatedCandidate, {
          lastConfidence: confidence ?? null,
          corrections: nextCorrections,
        });
        return maybePromptForSpelling(validatedCandidate, nextNameState);
      }
      if (nameState.candidate.value) {
        if (
          this.shouldPromptForNameSpelling(nameState, nameState.candidate.value)
        ) {
          return promptForNameSpelling(nameState.candidate.value, nameState);
        }
        return acknowledgeNameAndMoveOn(nameState.candidate.value);
      }

      if (!expectedField) {
        const extraSideReply = await this.buildSideQuestionReply(
          tenant.id,
          normalizedSpeech,
        );
        if (extraSideReply && !bookingIntent) {
          return this.replyWithBookingOffer({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            sourceEventId: currentEventId,
            message: extraSideReply,
            strategy: csrStrategy,
          });
        }
      }

      if (nameState.attemptCount >= 1) {
        await recordNameAttemptIfNeeded();
        return replyWithAddressPrompt();
      }

      return replyWithNameTwiml(this.buildAskNameTwiml(csrStrategy));
    }

    if (expectedField === "sms_phone") {
      const smsHandoff =
        this.conversationsService.getVoiceSmsHandoff(collectedData);
      if (!smsHandoff) {
        await this.clearVoiceListeningWindow({
          tenantId: tenant.id,
          conversationId,
        });
        expectedField = null;
      } else {
        const callerPhone = this.getCallerPhoneFromCollectedData(collectedData);
        const fallbackPhone = phoneState.value ?? callerPhone;
        const normalized =
          this.normalizeConfirmationUtterance(normalizedSpeech);
        const isSameNumber = this.isSmsNumberConfirmation(normalized);
        const parsedPhone = this.extractSmsPhoneCandidate(normalizedSpeech);
        if (isSameNumber && fallbackPhone) {
          await this.conversationsService.updateVoiceSmsPhoneState({
            tenantId: tenant.id,
            conversationId,
            phoneState: {
              ...phoneState,
              value: fallbackPhone,
              source: phoneState.source ?? "twilio_ani",
              confirmed: true,
              confirmedAt: new Date().toISOString(),
            },
          });
          await this.conversationsService.clearVoiceSmsHandoff({
            tenantId: tenant.id,
            conversationId,
          });
          await this.clearVoiceListeningWindow({
            tenantId: tenant.id,
            conversationId,
          });
          this.loggingService.log(
            {
              event: "voice.sms_phone_confirmed",
              tenantId: tenant.id,
              conversationId,
              callSid,
              source: "twilio_ani",
            },
            VoiceTurnService.name,
          );
          return this.replyWithSmsHandoff({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            reason: smsHandoff.reason,
            messageOverride: smsHandoff.messageOverride ?? undefined,
          });
        }
        if (parsedPhone) {
          await this.conversationsService.updateVoiceSmsPhoneState({
            tenantId: tenant.id,
            conversationId,
            phoneState: {
              ...phoneState,
              value: parsedPhone,
              source: "user_spoken",
              confirmed: true,
              confirmedAt: new Date().toISOString(),
            },
          });
          await this.conversationsService.clearVoiceSmsHandoff({
            tenantId: tenant.id,
            conversationId,
          });
          await this.clearVoiceListeningWindow({
            tenantId: tenant.id,
            conversationId,
          });
          this.loggingService.log(
            {
              event: "voice.sms_phone_confirmed",
              tenantId: tenant.id,
              conversationId,
              callSid,
              source: "user_spoken",
            },
            VoiceTurnService.name,
          );
          return this.replyWithSmsHandoff({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            reason: smsHandoff.reason,
            messageOverride: smsHandoff.messageOverride ?? undefined,
          });
        }

        const nextAttempt = phoneState.attemptCount + 1;
        if (nextAttempt < 2) {
          await this.conversationsService.updateVoiceSmsPhoneState({
            tenantId: tenant.id,
            conversationId,
            phoneState: {
              ...phoneState,
              attemptCount: nextAttempt,
              lastPromptedAt: new Date().toISOString(),
            },
          });
          this.loggingService.warn(
            {
              event: "voice.sms_phone_parse_failed",
              tenantId: tenant.id,
              conversationId,
              callSid,
              attemptCount: nextAttempt,
            },
            VoiceTurnService.name,
          );
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "sms_phone",
            sourceEventId: currentEventId,
            twiml: this.buildAskSmsNumberTwiml(csrStrategy),
          });
        }

        if (fallbackPhone) {
          await this.conversationsService.updateVoiceSmsPhoneState({
            tenantId: tenant.id,
            conversationId,
            phoneState: {
              ...phoneState,
              value: fallbackPhone,
              source: phoneState.source ?? "twilio_ani",
              confirmed: true,
              confirmedAt: new Date().toISOString(),
            },
          });
          await this.conversationsService.clearVoiceSmsHandoff({
            tenantId: tenant.id,
            conversationId,
          });
          await this.clearVoiceListeningWindow({
            tenantId: tenant.id,
            conversationId,
          });
          this.loggingService.warn(
            {
              event: "voice.sms_phone_defaulted",
              tenantId: tenant.id,
              conversationId,
              callSid,
            },
            VoiceTurnService.name,
          );
          return this.replyWithSmsHandoff({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            reason: smsHandoff.reason,
            messageOverride: smsHandoff.messageOverride ?? undefined,
          });
        }

        await this.conversationsService.clearVoiceSmsHandoff({
          tenantId: tenant.id,
          conversationId,
        });
        await this.clearVoiceListeningWindow({
          tenantId: tenant.id,
          conversationId,
        });
        return this.replyWithHumanFallback({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          reason: "sms_phone_missing",
        });
      }
    }

    if (expectedField === "address" && addressReady) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      expectedField = null;
    }
    if (!addressReady && (!expectedField || expectedField === "address")) {
      if (addressState.status === "FAILED") {
        return this.deferAddressToSmsAuthority({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          currentEventId,
          addressState,
          nameState,
          collectedData,
          strategy: csrStrategy,
          timingCollector,
        });
      }
      // First address ask after a multi-slot opening (name+issue captured in one turn).
      // Use the personalized preface so the caller hears "Thanks, David. I heard furnace
      // issue. What's the service address?" instead of the generic CSR opening prefix.
      if (openingAddressPreface && !addressState.candidate) {
        const preface = openingAddressPreface;
        openingAddressPreface = null;
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "address",
          sourceEventId: currentEventId,
          timeoutSec: 8,
          twiml: this.buildSayGatherTwiml(
            `${preface} What's the service address?`,
            { timeout: 8 },
          ),
        });
      }

      const duplicateMissing =
        !addressState.candidate &&
        addressState.sourceEventId === currentEventId;
      if (duplicateMissing) {
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "address",
          sourceEventId: currentEventId,
          twiml: this.buildAddressPromptForState(addressState, csrStrategy),
        });
      }

      if (addressState.needsLocality && addressState.candidate) {
        const normalizedLocality =
          this.normalizeAddressCandidate(normalizedSpeech);
        const localityParts = this.parseLocalityParts(normalizedLocality);
        const mergedCandidate = this.mergeAddressWithLocality(
          addressState.candidate,
          normalizedLocality,
        );
        const mergedParts = this.mergeAddressParts(addressState, localityParts);
        const mergedCandidateFromParts =
          this.buildAddressCandidateFromParts(mergedParts);
        const nextAddressState: typeof addressState = {
          ...addressState,
          ...mergedParts,
          candidate:
            mergedCandidate ||
            mergedCandidateFromParts ||
            addressState.candidate,
          needsLocality: false,
          sourceEventId: currentEventId,
        };
        await this.conversationsService.updateVoiceAddressState({
          tenantId: tenant.id,
          conversationId,
          addressState: nextAddressState,
        });
        const missingParts = this.getAddressMissingParts(nextAddressState);
        if (missingParts.locality) {
          return this.handleMissingLocalityPrompt({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            candidate: nextAddressState.candidate ?? "",
            addressState: nextAddressState,
            nameState,
            collectedData,
            currentEventId,
            displayName,
            strategy: csrStrategy,
            timingCollector,
          });
        }
        if (missingParts.houseNumber || missingParts.street) {
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            twiml: this.buildAddressPromptForState(
              nextAddressState,
              csrStrategy,
            ),
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "confirmation",
          targetField: "address",
          sourceEventId: currentEventId,
          twiml: this.buildAddressConfirmationTwiml(
            nextAddressState.candidate ?? "",
            csrStrategy,
          ),
        });
      }

      const candidateForEvent =
        Boolean(addressState.candidate) &&
        addressState.sourceEventId === currentEventId;
      if (candidateForEvent && addressState.candidate) {
        const hasStructured = this.hasStructuredAddressParts(addressState);
        const missingParts = this.getAddressMissingParts(addressState);
        const missingLocality = hasStructured
          ? missingParts.locality
          : this.isMissingLocality(addressState.candidate);
        const missingStreetOrNumber = hasStructured
          ? missingParts.houseNumber || missingParts.street
          : this.isIncompleteAddress(addressState.candidate);
        if (missingLocality) {
          return this.handleMissingLocalityPrompt({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            candidate: addressState.candidate,
            addressState,
            nameState,
            collectedData,
            currentEventId,
            displayName,
            strategy: csrStrategy,
            timingCollector,
          });
        }
        if (missingStreetOrNumber) {
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            twiml: this.buildAddressPromptForState(addressState, csrStrategy),
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "confirmation",
          targetField: "address",
          sourceEventId: currentEventId,
          twiml: this.buildAddressConfirmationTwiml(
            addressState.candidate,
            csrStrategy,
          ),
        });
      }

      if (addressState.candidate) {
        const localityCorrection = this.extractAddressLocalityCorrection(
          normalizedSpeech,
        );
        if (localityCorrection) {
          const mergedParts = this.mergeAddressParts(
            addressState,
            localityCorrection,
          );
          const mergedCandidate =
            this.buildAddressCandidateFromParts(mergedParts) ||
            this.mergeAddressWithLocality(
              addressState.candidate,
              this.normalizeAddressCandidate(normalizedSpeech),
            ) ||
            addressState.candidate;
          const nextAddressState: typeof addressState = {
            ...addressState,
            ...mergedParts,
            candidate: mergedCandidate,
            status: "CANDIDATE",
            needsLocality: false,
            sourceEventId: currentEventId,
          };
          await this.conversationsService.updateVoiceAddressState({
            tenantId: tenant.id,
            conversationId,
            addressState: nextAddressState,
          });
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "confirmation",
            targetField: "address",
            sourceEventId: currentEventId,
            twiml: this.buildAddressConfirmationTwiml(
              mergedCandidate,
              csrStrategy,
            ),
          });
        }

        if (
          this.isSoftConfirmationEligible(
            "address",
            addressState.candidate,
            normalizedSpeech,
            confidence,
          )
        ) {
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "confirmation",
            targetField: "address",
            sourceEventId: currentEventId,
            twiml: this.buildAddressSoftConfirmationTwiml(
              addressState.candidate,
              csrStrategy,
            ),
          });
        }
        const resolution = this.resolveConfirmation(
          normalizedSpeech,
          addressState.candidate,
          "address",
        );
        if (resolution.outcome === "CONFIRM") {
          const hasStructured = this.hasStructuredAddressParts(addressState);
          const missingParts = this.getAddressMissingParts(addressState);
          const missingLocality = hasStructured
            ? missingParts.locality
            : this.isMissingLocality(addressState.candidate);
          const missingStreetOrNumber = hasStructured
            ? missingParts.houseNumber || missingParts.street
            : this.isIncompleteAddress(addressState.candidate);
          if (missingLocality) {
            return this.handleMissingLocalityPrompt({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              candidate: addressState.candidate,
              addressState,
              nameState,
              collectedData,
              currentEventId,
              displayName,
              strategy: csrStrategy,
              timingCollector,
            });
          }
          if (missingStreetOrNumber) {
            return this.replyWithListeningWindow({
              res,
              tenantId: tenant.id,
              conversationId,
              field: "address",
              sourceEventId: currentEventId,
              twiml: this.buildAddressPromptForState(addressState, csrStrategy),
            });
          }
          if (!addressState.locked) {
            const confirmedAt = new Date().toISOString();
            const nextAddressState: typeof addressState = {
              ...addressState,
              status: "CANDIDATE",
              locked: true,
              sourceEventId: currentEventId,
            };
            await this.conversationsService.updateVoiceAddressState({
              tenantId: tenant.id,
              conversationId,
              addressState: nextAddressState,
              confirmation: {
                field: "address",
                value: addressState.candidate,
                confirmedAt,
                sourceEventId: currentEventId ?? "",
                channel: "VOICE",
              },
            });
            this.loggingService.log(
              {
                event: "voice.field_confirmed",
                field: "address",
                tenantId: tenant.id,
                conversationId,
                callSid,
                sourceEventId: currentEventId,
              },
              VoiceTurnService.name,
            );
          }
          await this.clearVoiceListeningWindow({
            tenantId: tenant.id,
            conversationId,
          });
          const issueCandidate = this.getVoiceIssueCandidate(collectedData);
          if (issueCandidate?.value) {
            return this.continueAfterSideQuestionWithIssueRouting({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              displayName,
              sideQuestionReply: "Perfect, thanks for confirming that.",
              expectedField: null,
              nameReady,
              addressReady: true,
              nameState,
              addressState: {
                ...addressState,
                locked: true,
                status: "CANDIDATE",
                sourceEventId: currentEventId,
              },
              collectedData,
              currentEventId,
              strategy: csrStrategy,
              timingCollector,
            });
          }
          return this.replyWithTwiml(
            res,
            this.buildSayGatherTwiml(
              "Perfect, thanks for confirming that. Now tell me what's been going on with the system.",
            ),
          );
        }
        if (resolution.outcome === "REJECT") {
          const nextAttempt = addressState.attemptCount + 1;
          const shouldFailClosed = nextAttempt >= 2;
          const nextAddressState: typeof addressState = {
            ...addressState,
            candidate: null,
            status: shouldFailClosed ? "FAILED" : "MISSING",
            attemptCount: nextAttempt,
            sourceEventId: currentEventId,
          };
          await this.conversationsService.updateVoiceAddressState({
            tenantId: tenant.id,
            conversationId,
            addressState: nextAddressState,
          });
          if (shouldFailClosed) {
            return this.deferAddressToSmsAuthority({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              displayName,
              currentEventId,
              addressState: nextAddressState,
              nameState,
              collectedData,
              strategy: csrStrategy,
              timingCollector,
            });
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            twiml: this.buildAddressPromptForState(
              nextAddressState,
              csrStrategy,
            ),
          });
        }
        if (
          resolution.outcome === "REPLACE_CANDIDATE" &&
          resolution.candidate
        ) {
          if (
            addressState.candidate &&
            this.isEquivalentAddressCandidate(
              addressState.candidate,
              resolution.candidate,
            )
          ) {
            const hasStructured = this.hasStructuredAddressParts(addressState);
            const missingParts = this.getAddressMissingParts(addressState);
            const missingLocality = hasStructured
              ? missingParts.locality
              : this.isMissingLocality(addressState.candidate);
            const missingStreetOrNumber = hasStructured
              ? missingParts.houseNumber || missingParts.street
              : this.isIncompleteAddress(addressState.candidate);
            if (missingLocality) {
              return this.handleMissingLocalityPrompt({
                res,
                tenantId: tenant.id,
                conversationId,
                callSid,
                candidate: addressState.candidate,
                addressState,
                nameState,
                collectedData,
                currentEventId,
                displayName,
                strategy: csrStrategy,
                timingCollector,
              });
            }
            if (missingStreetOrNumber) {
              return this.replyWithListeningWindow({
                res,
                tenantId: tenant.id,
                conversationId,
                field: "address",
                sourceEventId: currentEventId,
                twiml: this.buildAddressPromptForState(addressState, csrStrategy),
              });
            }
            if (!addressState.locked) {
              const confirmedAt = new Date().toISOString();
              const nextAddressState: typeof addressState = {
                ...addressState,
                status: "CANDIDATE",
                locked: true,
                sourceEventId: currentEventId,
              };
              await this.conversationsService.updateVoiceAddressState({
                tenantId: tenant.id,
                conversationId,
                addressState: nextAddressState,
                confirmation: {
                  field: "address",
                  value: addressState.candidate,
                  confirmedAt,
                  sourceEventId: currentEventId ?? "",
                  channel: "VOICE",
                },
              });
              this.loggingService.log(
                {
                  event: "voice.field_confirmed",
                  field: "address",
                  tenantId: tenant.id,
                  conversationId,
                  callSid,
                  sourceEventId: currentEventId,
                },
                VoiceTurnService.name,
              );
            }
            await this.clearVoiceListeningWindow({
              tenantId: tenant.id,
              conversationId,
            });
            const issueCandidate = this.getVoiceIssueCandidate(collectedData);
            if (issueCandidate?.value) {
              return this.continueAfterSideQuestionWithIssueRouting({
                res,
                tenantId: tenant.id,
                conversationId,
                callSid,
                displayName,
                sideQuestionReply: "Perfect, thanks for confirming that.",
                expectedField: null,
                nameReady,
                addressReady: true,
                nameState,
                addressState: {
                  ...addressState,
                  locked: true,
                  status: "CANDIDATE",
                  sourceEventId: currentEventId,
                },
                collectedData,
                currentEventId,
                strategy: csrStrategy,
                timingCollector,
              });
            }
            return this.replyWithTwiml(
              res,
              this.buildSayGatherTwiml(
                "Perfect, thanks for confirming that. Now tell me what's been going on with the system.",
              ),
            );
          }

          const nextAttempt = addressState.attemptCount + 1;
          const shouldFailClosed = nextAttempt >= 2;
          const nextAddressState: typeof addressState = {
            ...addressState,
            candidate: resolution.candidate,
            status: shouldFailClosed ? "FAILED" : "CANDIDATE",
            confidence: addressState.confidence,
            sourceEventId: currentEventId,
            attemptCount: nextAttempt,
          };
          await this.conversationsService.updateVoiceAddressState({
            tenantId: tenant.id,
            conversationId,
            addressState: nextAddressState,
          });
          if (shouldFailClosed) {
            return this.deferAddressToSmsAuthority({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              displayName,
              currentEventId,
              addressState: nextAddressState,
              nameState,
              collectedData,
              strategy: csrStrategy,
              timingCollector,
            });
          }
          const hasStructured =
            this.hasStructuredAddressParts(nextAddressState);
          const missingParts = this.getAddressMissingParts(nextAddressState);
          const missingLocality = hasStructured
            ? missingParts.locality
            : this.isMissingLocality(resolution.candidate);
          const missingStreetOrNumber = hasStructured
            ? missingParts.houseNumber || missingParts.street
            : this.isIncompleteAddress(resolution.candidate);
          if (missingLocality) {
            return this.handleMissingLocalityPrompt({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              candidate: resolution.candidate,
              addressState: nextAddressState,
              nameState,
              collectedData,
              currentEventId,
              displayName,
              strategy: csrStrategy,
              timingCollector,
            });
          }
          if (missingStreetOrNumber) {
            return this.replyWithListeningWindow({
              res,
              tenantId: tenant.id,
              conversationId,
              field: "address",
              sourceEventId: currentEventId,
              twiml: this.buildAddressPromptForState(
                nextAddressState,
                csrStrategy,
              ),
            });
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "confirmation",
            targetField: "address",
            sourceEventId: currentEventId,
            twiml: this.buildAddressConfirmationTwiml(
              resolution.candidate,
              csrStrategy,
            ),
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "confirmation",
          targetField: "address",
          sourceEventId: currentEventId,
          twiml: this.buildYesNoRepromptTwiml(csrStrategy),
        });
      }

      if (!expectedField) {
        const addressQuestionReply = await this.buildSideQuestionReply(
          tenant.id,
          normalizedSpeech,
        );
        if (addressQuestionReply) {
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            timeoutSec: 8,
            twiml: this.buildSayGatherTwiml(
              `${addressQuestionReply} Now, please say the service address.`,
              { timeout: 8 },
            ),
          });
        }
      }

      const normalizedAddressInput =
        this.normalizeAddressCandidate(normalizedSpeech);
      const fallbackCandidate = this.stripAddressLeadIn(normalizedAddressInput);
      const usableFallbackCandidate =
        fallbackCandidate && this.isLikelyAddressCandidate(fallbackCandidate)
          ? fallbackCandidate
          : "";
      const fallbackDerivedParts = usableFallbackCandidate
        ? this.extractAddressPartsFromCandidate(usableFallbackCandidate)
        : {};
      const directParts: {
        houseNumber?: string | null;
        street?: string | null;
      } = {};
      if (
        addressState.street &&
        !addressState.houseNumber &&
        this.isLikelyHouseNumberOnly(normalizedAddressInput)
      ) {
        directParts.houseNumber = normalizedAddressInput;
      }
      if (
        addressState.houseNumber &&
        !addressState.street &&
        this.isLikelyStreetOnly(normalizedAddressInput)
      ) {
        directParts.street = normalizedAddressInput;
      }
      const hasDeterministicLineSignal = Boolean(
        fallbackDerivedParts.houseNumber && fallbackDerivedParts.street,
      );
      const hasDeterministicSignal = Boolean(
        hasDeterministicLineSignal ||
          directParts.houseNumber ||
          directParts.street,
      );
      let extracted: Awaited<
        ReturnType<AiService["extractAddressCandidate"]>
      > | null = null;
      if (!hasDeterministicSignal) {
        extracted = await this.trackAiCall(timingCollector, () =>
          this.aiService.extractAddressCandidate(tenant.id, normalizedSpeech),
        );
      }
      const normalizedAddress = this.normalizeAddressCandidate(
        extracted?.address ?? "",
      );
      const seedCandidate =
        normalizedAddress ||
        usableFallbackCandidate ||
        addressState.candidate ||
        null;
      const extractedParts = this.compactAddressParts({
        houseNumber: this.normalizeAddressComponent(
          extracted?.houseNumber ?? undefined,
        ),
        street: this.normalizeAddressComponent(extracted?.street ?? undefined),
        city: this.normalizeAddressComponent(extracted?.city ?? undefined),
        state: this.normalizeAddressComponent(extracted?.state ?? undefined),
        zip: this.normalizeAddressComponent(extracted?.zip ?? undefined),
      });
      const derivedParts = seedCandidate
        ? this.extractAddressPartsFromCandidate(seedCandidate)
        : {};
      const mergedParts = this.mergeAddressParts(addressState, {
        ...derivedParts,
        ...extractedParts,
        ...directParts,
      });
      const structuredCandidate = this.buildAddressCandidateFromParts(mergedParts);
      const candidateAddress =
        structuredCandidate ||
        normalizedAddress ||
        usableFallbackCandidate ||
        addressState.candidate ||
        null;
      const minConfidence = this.config.voiceAddressMinConfidence ?? 0.7;
      const extractedConfidence =
        typeof extracted?.confidence === "number"
          ? extracted.confidence
          : undefined;
      const meetsConfidence =
        typeof extractedConfidence === "number"
          ? extractedConfidence >= minConfidence
          : hasDeterministicSignal || Boolean(usableFallbackCandidate);
      const baseAddressState: typeof addressState = {
        ...addressState,
        ...mergedParts,
        candidate: candidateAddress,
        confidence: extractedConfidence,
        sourceEventId: currentEventId,
      };
      const hasStructured = this.hasStructuredAddressParts(baseAddressState);
      const missingParts = this.getAddressMissingParts(baseAddressState);
      const missingStreetOrNumber = hasStructured
        ? missingParts.houseNumber || missingParts.street
        : !candidateAddress || this.isIncompleteAddress(candidateAddress);
      const missingLocality = hasStructured
        ? missingParts.locality
        : Boolean(candidateAddress && this.isMissingLocality(candidateAddress));
      if (!candidateAddress || missingStreetOrNumber || !meetsConfidence) {
        const nextAttempt = addressState.attemptCount + 1;
        const shouldFailClosed = nextAttempt >= 2;
        const nextAddressState: typeof addressState = {
          ...baseAddressState,
          status: shouldFailClosed ? "FAILED" : "CANDIDATE",
          attemptCount: nextAttempt,
          needsLocality: missingLocality && !shouldFailClosed,
        };
        await this.conversationsService.updateVoiceAddressState({
          tenantId: tenant.id,
          conversationId,
          addressState: nextAddressState,
        });
        if (shouldFailClosed) {
          return this.deferAddressToSmsAuthority({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            currentEventId,
            addressState: nextAddressState,
            nameState,
            collectedData,
            strategy: csrStrategy,
            timingCollector,
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "address",
          sourceEventId: currentEventId,
          twiml: this.buildAddressPromptForState(nextAddressState, csrStrategy),
        });
      }

      const nextAddressState: typeof addressState = {
        ...baseAddressState,
        status: "CANDIDATE",
        needsLocality: missingLocality,
      };
      await this.conversationsService.updateVoiceAddressState({
        tenantId: tenant.id,
        conversationId,
        addressState: nextAddressState,
      });
      if (missingLocality) {
        return this.handleMissingLocalityPrompt({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          candidate: candidateAddress ?? "",
          addressState: nextAddressState,
          nameState,
          collectedData,
          currentEventId,
          displayName,
          strategy: csrStrategy,
          timingCollector,
        });
      }
      return this.replyWithListeningWindow({
        res,
        tenantId: tenant.id,
        conversationId,
        field: "confirmation",
        targetField: "address",
        sourceEventId: currentEventId,
        twiml: this.buildAddressConfirmationTwiml(
          candidateAddress,
          csrStrategy,
        ),
      });
    }

    if (
      addressState.locked &&
      addressState.sourceEventId &&
      addressState.sourceEventId === currentEventId
    ) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      const issueCandidate = this.getVoiceIssueCandidate(collectedData);
      if (issueCandidate?.value) {
        return this.continueAfterSideQuestionWithIssueRouting({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          sideQuestionReply: "Perfect, thanks for confirming that.",
          expectedField: null,
          nameReady,
          addressReady: true,
          nameState,
          addressState: {
            ...addressState,
            locked: true,
            status: "CANDIDATE",
            sourceEventId: currentEventId,
          },
          collectedData,
          currentEventId,
          strategy: csrStrategy,
          timingCollector,
        });
      }
      return this.replyWithTwiml(
        res,
        this.buildSayGatherTwiml(
          "Perfect, thanks for confirming that. Now tell me what's been going on with the system.",
        ),
      );
    }

    const persistedIssueCandidate = this.getVoiceIssueCandidate(collectedData);
    let effectiveIssueCandidate = persistedIssueCandidate?.value ?? null;
    let capturedIssueFromCurrentTurn = false;
    if (effectiveIssueCandidate) {
      this.clearIssuePromptAttempts(callSid);
    }
    if (!effectiveIssueCandidate && nameReady && addressReady) {
      const issueFromTurn = this.normalizeIssueCandidate(normalizedSpeech);
      if (this.isLikelyIssueCandidate(issueFromTurn)) {
        this.clearIssuePromptAttempts(callSid);
        await this.conversationsService.updateVoiceIssueCandidate({
          tenantId: tenant.id,
          conversationId,
          issue: {
            value: issueFromTurn,
            sourceEventId: currentEventId ?? "",
            createdAt: new Date().toISOString(),
          },
        });
        effectiveIssueCandidate = issueFromTurn;
        capturedIssueFromCurrentTurn = true;
      } else if (turnPlan.type === "ASK_ISSUE") {
        return this.replyWithIssueCaptureRecovery({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          nameState,
          addressState,
          collectedData,
          strategy: csrStrategy,
          reason: "missing_issue_after_address",
          promptPrefix: this.isIssueRepeatComplaint(normalizedSpeech)
            ? "I hear you, and I'm sorry for the repeat."
            : undefined,
          transcript: normalizedSpeech,
        });
      }
    }

    try {
      const triageInput =
        capturedIssueFromCurrentTurn && effectiveIssueCandidate
          ? effectiveIssueCandidate
          : normalizedSpeech;
      const aiResult = await this.trackAiCall(timingCollector, () =>
        this.aiService.triage(tenant.id, callSid, triageInput, {
          conversationId,
          channel: CommunicationChannel.VOICE,
        }),
      );
      if (aiResult.status === "reply" && "reply" in aiResult) {
        const safeReply = this.capAiReply(aiResult.reply ?? "");
        if (
          (aiResult as { outcome?: string }).outcome === "sms_handoff" ||
          safeReply === this.buildSmsHandoffMessage()
        ) {
          const includeFees = this.shouldDiscloseFees({
            nameState,
            addressState,
            collectedData,
            currentSpeech: normalizedSpeech,
          });
          const feePolicy = includeFees
            ? await this.getTenantFeePolicySafe(tenant.id)
            : null;
          const smsMessage = this.buildSmsHandoffMessageForContext({
            feePolicy,
            includeFees,
            isEmergency: this.isUrgencyEmergency(collectedData),
            callerFirstName: this.getVoiceNameCandidate(nameState)?.split(" ").filter(Boolean)[0],
          });
          return this.replyWithSmsHandoff({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            reason: "ai_sms_handoff",
            messageOverride: smsMessage,
          });
        }
        if (
          nameReady &&
          addressReady &&
          effectiveIssueCandidate &&
          (this.isIssueCollectionPrompt(safeReply) ||
            this.isIssueReconfirmationPrompt(safeReply))
        ) {
          const includeFees = this.shouldDiscloseFees({
            nameState,
            addressState,
            collectedData,
            currentSpeech: effectiveIssueCandidate,
          });
          const feePolicy = includeFees
            ? await this.getTenantFeePolicySafe(tenant.id)
            : null;
          const smsMessage = this.buildSmsHandoffMessageForContext({
            feePolicy,
            includeFees,
            isEmergency: this.isUrgencyEmergency(collectedData),
            callerFirstName: this.getVoiceNameCandidate(nameState)?.split(" ").filter(Boolean)[0],
          });
          return this.replyWithSmsHandoff({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            reason: "ai_issue_reconfirm_guard",
            messageOverride: smsMessage,
          });
        }
        if (
          nameReady &&
          addressReady &&
          !effectiveIssueCandidate &&
          (this.isIssueCollectionPrompt(safeReply) ||
            this.isIssueReconfirmationPrompt(safeReply))
        ) {
          return this.replyWithIssueCaptureRecovery({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            nameState,
            addressState,
            collectedData,
            strategy: csrStrategy,
            reason: "ai_issue_prompt_missing",
            transcript: normalizedSpeech,
          });
        }
        if (this.shouldGatherMore(safeReply)) {
          return this.replyWithTwiml(res, this.buildSayGatherTwiml(safeReply));
        }
        if (this.isHumanFallbackMessage(safeReply)) {
          return this.replyWithHumanFallback({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            reason: "ai_fallback",
            messageOverride: safeReply,
          });
        }
        if (
          this.isLikelyQuestion(normalizedSpeech) &&
          !this.isBookingIntent(normalizedSpeech)
        ) {
          return this.replyWithBookingOffer({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            sourceEventId: currentEventId,
            message: safeReply,
            strategy: csrStrategy,
          });
        }
        this.logVoiceOutcome({
          outcome: "no_handoff",
          tenantId: tenant.id,
          conversationId,
          callSid,
          reason: "ai_reply_end",
        });
        return this.replyWithTwiml(res, this.buildTwiml(safeReply));
      }
      if (aiResult.status === "job_created" && "message" in aiResult) {
        const message = this.capAiReply(
          aiResult.message ?? "Your request has been booked.",
        );
        this.logVoiceOutcome({
          outcome: "no_handoff",
          tenantId: tenant.id,
          conversationId,
          callSid,
          reason: "job_created_in_voice",
        });
        return this.replyWithTwiml(res, this.buildTwiml(message));
      }
      return this.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        reason: "ai_unknown_status",
      });
    } catch {
      this.loggingService.warn(
        {
          event: "ai.preview_fallback",
          tenantId: tenant.id,
          callSid,
          conversationId,
          reason: "voice_triage_failed",
        },
        VoiceTurnService.name,
      );
      return this.replyWithHumanFallback({
        res,
        tenantId: tenant.id,
        conversationId,
        callSid,
        displayName,
        reason: "ai_preview_fallback",
        messageOverride:
          "We're having trouble handling your call. Please try again later.",
      });
    }
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
      const lastFour = handoffPreparation.fallbackPhone.replace(/\D/g, "").slice(-4);
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
          isEmergency: this.isUrgencyEmergency(handoffPreparation.collectedData),
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
        callerFirstName: this.getVoiceNameCandidate(params.nameState)?.split(" ").filter(Boolean)[0],
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
    const cleaned = this.sanitizationService.sanitizeText(value);
    const normalized = this.sanitizationService.normalizeWhitespace(cleaned);
    if (!normalized) {
      return "";
    }
    const canonicalized = normalized
      .replace(/\bno[\s,.-]*(?:eat|eet|8|eight)\b/gi, "no heat")
      .replace(/\bblowing\s+(?:code|coal|colde)\b/gi, "blowing cold")
      .replace(/\bno[\s,.-]*(?:a[\s.-]*c|ace)\b/gi, "no ac");
    return this.normalizeHvacIssueLexicon(canonicalized);
  }

  private buildFallbackIssueCandidate(value: string): string | null {
    const normalized = this.normalizeIssueCandidate(value);
    if (!normalized) {
      return null;
    }
    if (this.isLikelyQuestion(normalized)) {
      return null;
    }
    if (this.resolveBinaryUtterance(normalized)) {
      return null;
    }
    const phrase = normalized.toLowerCase();
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length < 4) {
      return null;
    }
    if (
      !/\b(no|not|wont|won't|stopped|stop|broken|issue|problem|leak|noise|smell|emergency|working|heat|cool|ac|furnace|unit|system|water|power|air)\b/.test(
        phrase,
      )
    ) {
      return null;
    }
    return normalized;
  }

  private normalizeHvacIssueLexicon(value: string): string {
    if (!value) {
      return "";
    }
    let normalized = value;
    const hasHvacContext =
      /\b(cold|heat|heating|hvac|furnace|ac|air|cool|blower|thermostat|unit)\b/i.test(
        normalized,
      );
    if (hasHvacContext) {
      normalized = normalized
        .replace(/\bmy friend\b/gi, "my furnace")
        .replace(/\bfriend\b/gi, "furnace")
        .replace(/\bgoing cold air\b/gi, "blowing cold air")
        .replace(/\bgoing out\b/gi, "blowing out");
    }
    return this.sanitizationService.normalizeWhitespace(normalized);
  }

  private isComfortRiskRelevant(value: string): boolean {
    const normalized = this.normalizeIssueCandidate(value).toLowerCase();
    if (!normalized) {
      return false;
    }
    return /\b(furnace|heat|heating|no heat|cold air|blowing cold|no cool(?:ing)?|no ac|ac|air conditioning|cooling|hvac)\b/.test(
      normalized,
    );
  }

  private buildIssueAcknowledgement(value: string): string | null {
    const normalized = this.normalizeIssueCandidate(value);
    if (!normalized) {
      return null;
    }
    const lower = normalized.toLowerCase();
    const keywords = [
      "furnace",
      "heat",
      "heating",
      "cold",
      "ac",
      "air conditioning",
      "cooling",
      "no heat",
      "no hot",
      "leak",
      "leaking",
      "water",
      "burst",
      "clog",
      "drain",
      "electrical",
      "power",
      "spark",
      "smell",
      "smoke",
      "gas",
      "broken",
      "not working",
      "stopped working",
      "went out",
      "went down",
      "blizzard",
    ];
    let startIndex = -1;
    for (const keyword of keywords) {
      const idx = lower.indexOf(keyword);
      if (idx >= 0 && (startIndex < 0 || idx < startIndex)) {
        startIndex = idx;
      }
    }
    const slice = startIndex >= 0 ? normalized.slice(startIndex) : normalized;
    let summary = this.sanitizationService.normalizeWhitespace(slice);
    const lowerSummary = summary.toLowerCase();
    const stopCandidates = [
      summary.search(/[.?!]/),
      lowerSummary.indexOf(" i was wondering"),
      lowerSummary.indexOf(" can you"),
      lowerSummary.indexOf(" could you"),
      lowerSummary.indexOf(" do you"),
      lowerSummary.indexOf(" would you"),
    ].filter((index) => index > 0);
    if (stopCandidates.length) {
      summary = summary.slice(0, Math.min(...stopCandidates));
    }
    summary = summary.replace(/[.?!]+$/, "");
    summary = summary.replace(/^my\s+/i, "your ");
    const lowerSummaryFinal = summary.toLowerCase();
    if (
      !lowerSummaryFinal.startsWith("your ") &&
      (lowerSummaryFinal.startsWith("furnace") ||
        lowerSummaryFinal.startsWith("ac") ||
        lowerSummaryFinal.startsWith("air conditioning") ||
        lowerSummaryFinal.startsWith("heating") ||
        lowerSummaryFinal.startsWith("cooling"))
    ) {
      summary = `your ${summary}`;
    }
    if (!summary) {
      return null;
    }
    // Quality guard: if the summary looks garbled (too many filler/function words
    // relative to content words), fall back to a clean category label so we don't
    // echo broken STT verbatim (e.g. "your furnace is doing cold here when she doing warmer").
    const words = summary.split(/\s+/).filter(Boolean);
    const fillerWords = new Set([
      "is", "are", "was", "were", "be", "been", "being",
      "it", "its", "it's", "the", "a", "an", "and", "or", "but",
      "in", "on", "at", "to", "for", "of", "with", "by", "from",
      "here", "there", "when", "while", "she", "he", "they", "we",
      "doing", "going", "getting", "just", "so", "that", "this",
      "i", "my", "me", "you", "your",
    ]);
    const fillerCount = words.filter((w) =>
      fillerWords.has(w.toLowerCase()),
    ).length;
    const fillerRatio = words.length > 0 ? fillerCount / words.length : 0;
    if (fillerRatio > 0.55 && words.length > 4) {
      // Too garbled — derive a clean category label from the original value instead
      const lowerValue = value.toLowerCase();
      if (/\b(furnace|heat|heating|no heat|blowing cold|cold air)\b/.test(lowerValue)) {
        return "your furnace issue";
      }
      if (/\b(ac|air conditioning|cooling|no cool)\b/.test(lowerValue)) {
        return "your AC issue";
      }
      if (/\b(leak|leaking|water|burst|pipe)\b/.test(lowerValue)) {
        return "your plumbing issue";
      }
      if (/\b(electrical|power|spark|outlet|breaker)\b/.test(lowerValue)) {
        return "your electrical issue";
      }
      if (/\b(drain|clog|toilet|sewer)\b/.test(lowerValue)) {
        return "your drain issue";
      }
      if (/\b(gas|smell|smoke|carbon)\b/.test(lowerValue)) {
        return "your gas or smell concern";
      }
      return "your service request";
    }
    return summary;
  }

  private isLikelyIssueCandidate(value: string): boolean {
    const normalized = this.normalizeIssueCandidate(value).toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized.length < 6) {
      return false;
    }
    if (
      /\b(furnace|heater|heat|heating|cold|air conditioning|cooling|no heat|no hot|no[\s,.-]*(?:eat|eet|8|eight)|leak|leaking|water|burst|clog|drain|electrical|power|spark|smell|smoke|gas|broken|not working|stopped working|went out|went down|blizzard|acting up|issue|problem|hvac|no ac|short cycling|cycle on and off|not heating|not cooling)\b/.test(
        normalized,
      )
    ) {
      return true;
    }
    if (
      /\b(need|send|dispatch|book|schedule|someone|technician|tech)\b.*\b(come|come out|check|look|repair|fix|service|help)\b/.test(
        normalized,
      )
    ) {
      return true;
    }
    if (
      /\b(won'?t (?:turn on|start)|not (?:coming on|turning on|working)|blowing (?:cold|hot) air|no airflow|making (?:a )?(?:loud )?noise|water (?:on|around) (?:the )?(?:unit|furnace|system|floor)|smell(?:ing)? gas)\b/.test(
        normalized,
      )
    ) {
      return true;
    }
    if (
      /\b(thermostat|pilot|compressor|blower|fan|hot water|frozen|ice)\b/.test(
        normalized,
      ) &&
      /\b(no|not|won'?t|stopped|broken|issue|problem|acting up)\b/.test(
        normalized,
      )
    ) {
      return true;
    }
    return /\bac\b/.test(normalized);
  }

  private isIssueRepeatComplaint(value: string): boolean {
    if (!value) {
      return false;
    }
    const normalized = value.toLowerCase();
    return /(i told you|already told you|i already said|you asked (me )?already|you keep asking|you keep repeating|stop asking|asked that already|you asked this already|you already asked)/.test(
      normalized,
    );
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

  private async handleVoiceIssueCandidate(params: {
    res?: Response;
    tenantId: string;
    callSid: string;
    conversationId: string;
    issueCandidate: string;
    currentEventId: string | null;
    displayName: string;
    includeFees: boolean;
    isEmergency: boolean;
    nameState?: ReturnType<ConversationsService["getVoiceNameState"]>;
    timingCollector?: VoiceTurnTimingCollector;
  }) {
    try {
      const aiResult = await this.trackAiCall(params.timingCollector, () =>
        this.aiService.triage(
          params.tenantId,
          params.callSid,
          params.issueCandidate,
          {
            conversationId: params.conversationId,
            channel: CommunicationChannel.VOICE,
          },
        ),
      );
      if (aiResult.status === "reply" && "reply" in aiResult) {
        const safeReply = this.capAiReply(aiResult.reply ?? "");
        if (
          this.isIssueCollectionPrompt(safeReply) ||
          this.isIssueReconfirmationPrompt(safeReply)
        ) {
          const feePolicy = params.includeFees
            ? await this.getTenantFeePolicySafe(params.tenantId)
            : null;
          const smsMessage = this.buildSmsHandoffMessageForContext({
            feePolicy,
            includeFees: params.includeFees,
            isEmergency: params.isEmergency,
            callerFirstName: params.nameState ? this.getVoiceNameCandidate(params.nameState)?.split(" ").filter(Boolean)[0] : undefined,
          });
          return this.replyWithSmsHandoff({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            callSid: params.callSid,
            displayName: params.displayName,
            reason: "issue_candidate_reconfirm_guard",
            messageOverride: smsMessage,
          });
        }
        if (this.shouldGatherMore(safeReply)) {
          return this.replyWithTwiml(
            params.res,
            this.buildSayGatherTwiml(safeReply),
          );
        }
        if (
          (aiResult as { outcome?: string }).outcome === "sms_handoff" ||
          safeReply === this.buildSmsHandoffMessage()
        ) {
          const feePolicy = params.includeFees
            ? await this.getTenantFeePolicySafe(params.tenantId)
            : null;
          const smsMessage = this.buildSmsHandoffMessageForContext({
            feePolicy,
            includeFees: params.includeFees,
            isEmergency: params.isEmergency,
            callerFirstName: params.nameState ? this.getVoiceNameCandidate(params.nameState)?.split(" ").filter(Boolean)[0] : undefined,
          });
          return this.replyWithSmsHandoff({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            callSid: params.callSid,
            displayName: params.displayName,
            reason: "ai_sms_handoff",
            messageOverride: smsMessage,
          });
        }
        return this.replyWithTwiml(params.res, this.buildTwiml(safeReply));
      }
    } catch (error) {
      this.loggingService.warn(
        {
          event: "voice.issue_candidate_failed",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          error: (error as Error).message,
        },
        VoiceTurnService.name,
      );
    }
    return this.replyWithHumanFallback({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      displayName: params.displayName,
      reason: "issue_candidate_failed",
      messageOverride: "Thanks. We'll follow up shortly.",
    });
  }

  private capAiReply(value: string): string {
    const trimmed = value?.trim() ?? "";
    if (!trimmed) {
      return "Thanks. We'll follow up shortly.";
    }
    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
  }

  private shouldGatherMore(reply: string): boolean {
    return reply.trim().endsWith("?");
  }

  private isIssueCollectionPrompt(reply: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(reply);
    if (!normalized) {
      return false;
    }
    return /\b(main issue|brief description|short summary|describe (?:the )?issue|what(?:'s| is) (?:the )?issue|what(?:'s| is) (?:been )?going on with (?:the )?(?:system|unit)|what seems to be the issue)\b/.test(
      normalized,
    );
  }

  private isIssueReconfirmationPrompt(reply: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(reply);
    if (!normalized) {
      return false;
    }
    const hasIssuePhrase =
      /\b(issue|problem|heating|cooling|furnace|ac|air conditioning|no heat|no ac|cold air|leak|electrical|plumbing)\b/.test(
        normalized,
      ) && /\b(sound|seem|dealing with|experiencing|having|might be)\b/.test(
        normalized,
      );
    if (!hasIssuePhrase) {
      return false;
    }
    return /\b(is that correct|is this correct|can you confirm|does that sound right|is that right|right\?)\b/.test(
      normalized,
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

  private shouldIgnoreStreamingTranscript(
    transcript: string,
    collectedData: unknown,
    expectedField?: VoiceExpectedField | null,
  ): boolean {
    const normalized = transcript.toLowerCase().trim();
    if (!normalized) {
      return true;
    }
    const listeningWindow = this.getVoiceListeningWindow(collectedData);
    const isConfirmationWindow = listeningWindow?.field === "confirmation";
    if (
      this.isSlowDownRequest(normalized) ||
      this.isFrustrationRequest(normalized) ||
      this.isHumanTransferRequest(normalized) ||
      this.isSmsDifferentNumberRequest(normalized) ||
      this.isHangupRequest(normalized)
    ) {
      return false;
    }
    if (isConfirmationWindow) {
      return false;
    }
    // Keep yes/no utterances so late-confirmation replies are not dropped.
    if (this.resolveBinaryUtterance(normalized)) {
      return false;
    }
    if (/\d/.test(normalized)) {
      return false;
    }
    const normalizedCandidate = this.normalizeNameCandidate(normalized);
    if (
      this.isValidNameCandidate(normalizedCandidate) &&
      this.isLikelyNameCandidate(normalizedCandidate)
    ) {
      return false;
    }
    if (this.isLikelyIssueCandidate(this.normalizeIssueCandidate(normalized))) {
      return false;
    }
    const confirmation = this.normalizeConfirmationUtterance(normalized);
    if (this.isSmsNumberConfirmation(confirmation)) {
      return false;
    }
    if (
      /(thank you for calling|this call may be recorded|this call may be transcribed|by continuing)/.test(
        normalized,
      )
    ) {
      return true;
    }
    if (
      expectedField === "address" &&
      !/\d/.test(normalized) &&
      !/\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|pl|place|cir|circle)\b/.test(
        normalized,
      )
    ) {
      return true;
    }
    if (/^(my address is|the address is|address is)$/.test(normalized)) {
      return true;
    }
    if (normalized.length <= 3) {
      return true;
    }
    return /\b(hold on|hang on|one sec|one second|just a sec|give me a sec|wait|um|uh|hmm|okay|ok|yeah|yep|right|sure|thanks|thank you)\b/.test(
      normalized,
    );
  }

  private isListeningWindowExpired(
    window: VoiceListeningWindow,
    now: Date,
  ): boolean {
    const expiresAt = Date.parse(window.expiresAt);
    return Number.isNaN(expiresAt) || expiresAt <= now.getTime();
  }

  private getExpectedListeningField(
    window: VoiceListeningWindow | null,
  ): VoiceExpectedField | null {
    if (!window) {
      return null;
    }
    if (window.field === "confirmation") {
      return window.targetField ?? null;
    }
    return window.field;
  }

  private shouldClearListeningWindow(
    window: VoiceListeningWindow,
    now: Date,
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>,
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>,
    phoneState: ReturnType<ConversationsService["getVoiceSmsPhoneState"]>,
  ): boolean {
    if (this.isListeningWindowExpired(window, now)) {
      return true;
    }
    const expectedField = this.getExpectedListeningField(window);
    if (expectedField === "name") {
      return nameState.locked || nameState.attemptCount >= 3;
    }
    if (expectedField === "address") {
      return (
        addressState.locked ||
        addressState.status === "FAILED" ||
        addressState.attemptCount >= 2
      );
    }
    if (expectedField === "sms_phone") {
      return phoneState.confirmed || phoneState.attemptCount >= 2;
    }
    if (
      expectedField === "booking" ||
      expectedField === "callback" ||
      expectedField === "comfort_risk" ||
      expectedField === "urgency_confirm"
    ) {
      return this.isListeningWindowExpired(window, now);
    }
    return false;
  }

  private buildListeningWindowReprompt(params: {
    window: VoiceListeningWindow | null;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    phoneState: ReturnType<ConversationsService["getVoiceSmsPhoneState"]>;
    strategy?: CsrStrategy;
  }): string {
    const expectedField = this.getExpectedListeningField(params.window);
    if (expectedField === "name") {
      return this.buildAskNameTwiml(params.strategy);
    }
    if (expectedField === "address") {
      return this.buildAddressPromptForState(
        params.addressState,
        params.strategy,
      );
    }
    if (expectedField === "sms_phone") {
      return this.buildAskSmsNumberTwiml(params.strategy);
    }
    if (expectedField === "booking") {
      return this.buildBookingPromptTwiml(params.strategy);
    }
    if (expectedField === "callback") {
      return this.buildCallbackOfferTwiml(params.strategy);
    }
    if (expectedField === "comfort_risk") {
      return this.buildUrgencyConfirmTwiml(params.strategy);
    }
    if (expectedField === "urgency_confirm") {
      return this.buildUrgencyConfirmTwiml(params.strategy);
    }
    return this.buildRepromptTwiml(params.strategy);
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
  ): ConfirmationResolution {
    const normalized = this.normalizeConfirmationUtterance(utterance);
    const confirmPhrases = [
      "yes",
      "yeah",
      "yep",
      "yup",
      "yah",
      "ya",
      "yuh",
      "yellow",
      "yello",
      "correct",
      "that's right",
      "that is right",
      "right",
      "ok",
      "okay",
      "affirmative",
    ];
    const rejectPhrases = [
      "no",
      "nope",
      "incorrect",
      "that's wrong",
      "that is wrong",
      "not right",
      "negative",
    ];
    if (confirmPhrases.some((phrase) => normalized === phrase)) {
      return { outcome: "CONFIRM", candidate: null };
    }
    if (rejectPhrases.some((phrase) => normalized === phrase)) {
      return { outcome: "REJECT", candidate: null };
    }
    const candidate = this.extractReplacementCandidate(utterance, fieldType);
    if (candidate) {
      return { outcome: "REPLACE_CANDIDATE", candidate };
    }
    if (currentCandidate) {
      return { outcome: "UNKNOWN", candidate: null };
    }
    return { outcome: "UNKNOWN", candidate: null };
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
        ? this.normalizeNameCandidate(utterance)
        : this.sanitizationService.normalizeWhitespace(
            this.normalizeAddressCandidate(utterance),
          );
    if (!normalizedCandidate) {
      return false;
    }
    if (fieldType === "name") {
      if (
        !this.isValidNameCandidate(normalizedCandidate) ||
        !this.isLikelyNameCandidate(normalizedCandidate)
      ) {
        return false;
      }
    } else if (this.isIncompleteAddress(normalizedCandidate)) {
      return false;
    }
    return (
      normalizedCandidate.trim().toLowerCase() ===
      candidate.trim().toLowerCase()
    );
  }

  private normalizeConfirmationUtterance(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private isSmsNumberConfirmation(normalizedUtterance: string): boolean {
    const directMatches = [
      "yes",
      "yeah",
      "yep",
      "yup",
      "yah",
      "ya",
      "yuh",
      "yellow",
      "yello",
      "correct",
      "perfect",
      "sure",
      "sounds good",
      "that works",
      "that's fine",
      "that is fine",
      "that's good",
      "that is good",
      "works for me",
      "go ahead",
      "that's correct",
      "that is correct",
      "that's right",
      "that is right",
      "this one",
      "this number",
      "same number",
      "use this",
      "use this number",
      "that number",
      "that number works",
      "that number's fine",
      "that number is fine",
    ];
    if (directMatches.includes(normalizedUtterance)) {
      return true;
    }
    return (
      normalizedUtterance.includes("this number") ||
      normalizedUtterance.includes("same number") ||
      normalizedUtterance.includes("this one") ||
      normalizedUtterance.startsWith("use this") ||
      normalizedUtterance.includes("that works") ||
      normalizedUtterance.includes("sounds good") ||
      normalizedUtterance.includes("that number")
    );
  }

  private extractSmsPhoneCandidate(utterance: string): string | null {
    const normalized = this.sanitizationService.normalizePhoneE164(utterance);
    return normalized || null;
  }

  private getCallerPhoneFromCollectedData(
    collectedData: Prisma.JsonValue | null | undefined,
  ): string | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const data = collectedData as Record<string, unknown>;
    return typeof data.callerPhone === "string" ? data.callerPhone : null;
  }

  private extractReplacementCandidate(
    utterance: string,
    fieldType: "name" | "address",
  ): string | null {
    const cleaned = this.sanitizationService.sanitizeText(utterance);
    const stripped = this.stripConfirmationPrefix(cleaned);
    if (!stripped) {
      return null;
    }
    if (fieldType === "name") {
      const candidate = this.normalizeNameCandidate(stripped);
      if (
        !candidate ||
        !this.isValidNameCandidate(candidate) ||
        !this.isLikelyNameCandidate(candidate)
      ) {
        return null;
      }
      return candidate;
    }
    const candidate = this.sanitizationService.normalizeWhitespace(
      this.normalizeAddressCandidate(stripped),
    );
    if (!candidate || this.isIncompleteAddress(candidate)) {
      return null;
    }
    return candidate;
  }

  private stripConfirmationPrefix(value: string): string {
    const cleaned = this.sanitizationService.normalizeWhitespace(value);
    const lowered = cleaned.toLowerCase();
    const prefixes = [
      "yes",
      "yeah",
      "yep",
      "yup",
      "yah",
      "ya",
      "yuh",
      "yellow",
      "yello",
      "correct",
      "that's right",
      "that is right",
      "right",
      "ok",
      "okay",
      "affirmative",
      "no",
      "nope",
      "incorrect",
      "that's wrong",
      "that is wrong",
      "not right",
      "negative",
    ];
    for (const prefix of prefixes) {
      if (lowered === prefix) {
        return "";
      }
      if (
        lowered.startsWith(`${prefix} `) ||
        lowered.startsWith(`${prefix},`) ||
        lowered.startsWith(`${prefix}.`) ||
        lowered.startsWith(`${prefix}!`) ||
        lowered.startsWith(`${prefix}?`)
      ) {
        const remainder = cleaned
          .slice(prefix.length)
          .replace(/^[\s,!.?]+/, "");
        return remainder.replace(/^(?:it's|it is|its|that is|that's)\s+/i, "");
      }
    }
    return cleaned;
  }

  private async buildSideQuestionReply(
    tenantId: string,
    transcript: string,
  ): Promise<string | null> {
    const cleaned = this.sanitizationService.normalizeWhitespace(transcript);
    const stripped = this.stripConfirmationPrefix(cleaned);
    if (!stripped) {
      return null;
    }
    const normalized = stripped.toLowerCase();

    if (
      /(say yes to what|yes to what|what (are|am) you asking|what are you asking for|what do you need|what is this for)/.test(
        normalized,
      )
    ) {
      return "I'm confirming your details so we can send the right technician.";
    }

    if (
      /(i was speaking to you|talking to you|speaking to you)/.test(normalized)
    ) {
      return "I'm right here to help. I just need a couple of quick details.";
    }

    if (/(how are you|how you doing|how's it going)/.test(normalized)) {
      return "I'm doing well, thanks for asking.";
    }

    if (!this.isLikelyQuestion(normalized)) {
      return null;
    }

    if (/(fee|cost|price|charge|diagnostic)/.test(normalized)) {
      const feePolicy = await this.getTenantFeePolicySafe(tenantId);
      const { serviceFee, creditWindowHours } =
        this.getTenantFeeConfig(feePolicy);
      const creditWindowLabel =
        creditWindowHours === 1 ? "1 hour" : `${creditWindowHours} hours`;
      return typeof serviceFee === "number"
        ? `The service fee is ${this.formatFeeAmount(
            serviceFee,
          )}, and it's credited toward repairs if you approve within ${creditWindowLabel}.`
        : `A service fee applies, and it's credited toward repairs if you approve within ${creditWindowLabel}.`;
    }

    if (
      /(do you|do you guys|can you|will you)\s+(come|send|dispatch|service|work on|handle|repair|fix|check|look at|look over|check out|take a look)/.test(
        normalized,
      )
    ) {
      return "Yes, we can help with that.";
    }

    if (
      /(when|availability|available|can you come|how soon)/.test(normalized)
    ) {
      return "We can check availability once I have your address.";
    }

    if (
      /(who (are|am) i speaking with|who is this|what's your name)/.test(
        normalized,
      )
    ) {
      try {
        const tenant = await this.tenantsService.getTenantContext(tenantId);
        return `You're speaking with the dispatcher at ${tenant.displayName}.`;
      } catch {
        return "You're speaking with the dispatcher.";
      }
    }

    return "I can help with that. Let me grab a couple quick details.";
  }

  private async replyWithSideQuestionAndContinue(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sideQuestionReply: string;
    expectedField: VoiceListeningField | null;
    nameReady: boolean;
    addressReady: boolean;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    currentEventId: string | null;
    strategy?: CsrStrategy;
  }): Promise<string | null> {
    const preface = params.sideQuestionReply.trim();
    if (!preface) {
      return null;
    }

    if (
      !params.nameReady &&
      (!params.expectedField || params.expectedField === "name")
    ) {
      const baseTwiml = this.buildAskNameTwiml(params.strategy);
      const twiml = this.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "name",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    if (
      !params.addressReady &&
      (!params.expectedField || params.expectedField === "address")
    ) {
      const baseTwiml = this.buildAddressPromptForState(
        params.addressState,
        params.strategy,
      );
      const twiml = this.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "address",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    if (params.expectedField === "sms_phone") {
      const baseTwiml = this.buildAskSmsNumberTwiml(params.strategy);
      const twiml = this.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "sms_phone",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    if (params.expectedField === "booking") {
      const baseTwiml = this.buildBookingPromptTwiml(params.strategy);
      const twiml = this.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "confirmation",
        targetField: "booking",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    if (params.expectedField === "callback") {
      const baseTwiml = this.buildCallbackOfferTwiml(params.strategy);
      const twiml = this.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "confirmation",
        targetField: "callback",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    return null;
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
    const followUp = await this.replyWithSideQuestionAndContinue({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      sideQuestionReply: params.sideQuestionReply,
      expectedField: params.expectedField,
      nameReady: params.nameReady,
      addressReady: params.addressReady,
      addressState: params.addressState,
      currentEventId: params.currentEventId,
      strategy: params.strategy,
    });
    if (followUp) {
      return followUp;
    }

    if (params.nameReady && params.addressReady) {
      const issueCandidate = this.getVoiceIssueCandidate(params.collectedData);
      if (issueCandidate?.value) {
        this.clearIssuePromptAttempts(params.callSid);
        const includeFees = this.shouldDiscloseFees({
          nameState: params.nameState,
          addressState: params.addressState,
          collectedData: params.collectedData,
        });
        const feePolicy = includeFees
          ? await this.getTenantFeePolicySafe(params.tenantId)
          : null;
        const smsMessage = this.buildSmsHandoffMessageForContext({
          feePolicy,
          includeFees,
          isEmergency: this.isUrgencyEmergency(params.collectedData),
          callerFirstName: this.getVoiceNameCandidate(params.nameState)?.split(" ").filter(Boolean)[0],
        });
        return this.replyWithSmsHandoff({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          reason: "post_side_question_sms_handoff",
          messageOverride: smsMessage,
        });
      }
      return this.replyWithIssueCaptureRecovery({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        nameState: params.nameState,
        addressState: params.addressState,
        collectedData: params.collectedData,
        strategy: params.strategy,
        reason: "missing_issue_post_side_question",
      });
    }

    return this.replyWithTwiml(
      params.res,
      this.buildSayGatherTwiml("How can I help?"),
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
    const existingIssueCandidate =
      this.getVoiceIssueCandidate(params.collectedData)?.value ?? null;
    const existingIssue = existingIssueCandidate
      ? this.normalizeIssueCandidate(existingIssueCandidate)
      : null;
    const detectedIssueCandidate = this.normalizeIssueCandidate(
      params.transcript ?? "",
    );
    const fallbackIssue = this.buildFallbackIssueCandidate(
      params.transcript ?? "",
    );
    const detectedIssue = this.isLikelyIssueCandidate(detectedIssueCandidate)
      ? detectedIssueCandidate
      : fallbackIssue;
    const askCount = this.issuePromptAttemptsByCall.get(params.callSid) ?? 0;
    const decision = reduceIssueSlot(
      {
        status: existingIssue ? "CAPTURED" : "MISSING",
        value: existingIssue,
        askCount,
      },
      {
        existingIssue,
        detectedIssue,
        isQuestion: this.isLikelyQuestion(params.transcript ?? ""),
      },
    );
    this.issuePromptAttemptsByCall.set(params.callSid, decision.nextState.askCount);

    if (
      decision.action.type === "ALREADY_CAPTURED" ||
      decision.action.type === "CAPTURE_ISSUE"
    ) {
      if (decision.action.type === "CAPTURE_ISSUE") {
        const sourceEventId = getRequestContext()?.sourceEventId ?? "";
        await this.conversationsService.updateVoiceIssueCandidate({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          issue: {
            value: decision.action.value,
            sourceEventId,
            createdAt: new Date().toISOString(),
          },
        });
      }
      this.clearIssuePromptAttempts(params.callSid);
      const includeFees = this.shouldDiscloseFees({
        nameState: params.nameState,
        addressState: params.addressState,
        collectedData: params.collectedData,
        currentSpeech: params.transcript,
      });
      const feePolicy = includeFees
        ? await this.getTenantFeePolicySafe(params.tenantId)
        : null;
      const smsMessage = this.buildSmsHandoffMessageForContext({
        feePolicy,
        includeFees,
        isEmergency: this.isUrgencyEmergency(params.collectedData),
        callerFirstName: this.getVoiceNameCandidate(params.nameState)?.split(" ").filter(Boolean)[0],
      });
      return this.replyWithSmsHandoff({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        reason: `${params.reason}_captured`,
        messageOverride: smsMessage,
      });
    }

    if (decision.action.type === "DEFER_TO_SMS") {
      this.loggingService.log(
        {
          event: "voice.issue_capture_deferred_to_sms",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          attempt: decision.nextState.askCount,
          reason: params.reason,
        },
        VoiceTurnService.name,
      );
      return this.replyWithSmsHandoff({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        reason: `${params.reason}_deferred_to_sms`,
        messageOverride: ISSUE_SLOT_SMS_DEFER_MESSAGE,
      });
    }

    const prompt = buildIssueSlotPrompt({ prefix: params.promptPrefix });
    return this.replyWithTwiml(
      params.res,
      this.buildSayGatherTwiml(this.applyCsrStrategy(params.strategy, prompt)),
    );
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
    if (!transcript) {
      return false;
    }
    if (transcript.trim().endsWith("?")) {
      return true;
    }
    return /^(who|what|when|where|why|how|can|do|does|is|are|will)\b/i.test(
      transcript.trim(),
    );
  }

  private isBookingIntent(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return /\b(book|schedule|appointment|visit|dispatch|send someone|send a tech|come out|come over|set up)\b/.test(
      normalized,
    );
  }

  private isSlowDownRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    if (
      /\b(hold on|hang on|wait|one sec|one second|just a sec|give me a sec)\b/.test(
        normalized,
      )
    ) {
      return true;
    }
    if (/\btoo fast\b/.test(normalized)) {
      return true;
    }
    return /\bslow\b.*\bdown\b/.test(normalized);
  }

  private isFrustrationRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    if (this.isSlowDownRequest(normalized)) {
      return false;
    }
    return /\b(human|agent|representative|supervisor|manager|person|operator|buggy|repeating|not listening|ridiculous|frustrated|annoying|robotic|already told|told you already|said that already)\b/.test(
      normalized,
    );
  }

  private isHumanTransferRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    if (
      /\b(human|agent|representative|supervisor|manager|operator)\b/.test(
        normalized,
      )
    ) {
      return true;
    }
    return /\b(?:talk|speak)\s+to\s+(?:a|an|the)?\s*(?:human|agent|representative|supervisor|manager|person|someone|operator)\b/.test(
      normalized,
    );
  }

  private isSmsDifferentNumberRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    if (!normalized) {
      return false;
    }
    return /\b(different number|another number|use another number|new number|text (?:me )?at another number|text a different number)\b/.test(
      normalized,
    );
  }

  private isHangupRequest(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return /\b(bye|goodbye|hang up|hangup|stop calling|no thanks|no thank you|cancel|never mind|nevermind|that'?s all)\b/.test(
      normalized,
    );
  }

  private isOpeningGreetingOnly(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    if (!normalized) {
      return false;
    }
    if (this.extractNameCandidateDeterministic(transcript)) {
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
    return [
      "yes",
      "yeah",
      "yep",
      "yup",
      "yah",
      "ya",
      "yuh",
      "yellow",
      "yello",
      "correct",
      "that's right",
      "that is right",
      "right",
      "ok",
      "okay",
      "affirmative",
      "sure",
      "please",
      "go ahead",
      "perfect",
      "that's perfect",
      "that is perfect",
    ].includes(normalized);
  }

  private resolveBinaryUtterance(transcript: string): "YES" | "NO" | null {
    if (this.isAffirmativeUtterance(transcript)) {
      return "YES";
    }
    if (this.isNegativeUtterance(transcript)) {
      return "NO";
    }
    const normalized = this.normalizeConfirmationUtterance(transcript);
    if (!normalized) {
      return null;
    }
    if (
      /\b(not an emergency|not emergency|non emergency|this is not an emergency)\b/.test(
        normalized,
      )
    ) {
      return "NO";
    }
    if (
      /\b(no (?:elderly|kids?|children)|no one (?:is )?at risk|nobody (?:is )?at risk|not at risk|no urgent concerns?|nothing urgent|no risk)\b/.test(
        normalized,
      )
    ) {
      return "NO";
    }
    if (
      /^(yes|yeah|yep|yup|yah|ya|yuh|yellow|yello|correct|right|affirmative|sure|ok|okay)\b/.test(
        normalized,
      )
    ) {
      return "YES";
    }
    if (/^(no|nope|negative)\b/.test(normalized)) {
      if (
        /\b(no heat|no ac|no air|no cooling|no water|no power|not working|won't turn on)\b/.test(
          normalized,
        )
      ) {
        return null;
      }
      return "NO";
    }
    return null;
  }

  private isNegativeUtterance(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return [
      "no",
      "nope",
      "incorrect",
      "that's wrong",
      "that is wrong",
      "not right",
      "negative",
      "not now",
    ].includes(normalized);
  }

  private isDuplicateTranscript(
    collectedData: unknown,
    transcript: string,
    now: Date,
  ): boolean {
    if (!collectedData || typeof collectedData !== "object") {
      return false;
    }
    const data = collectedData as Record<string, unknown>;
    const lastTranscript =
      typeof data.lastTranscript === "string" ? data.lastTranscript : null;
    const lastTranscriptAt =
      typeof data.lastTranscriptAt === "string" ? data.lastTranscriptAt : null;
    if (!lastTranscript || !lastTranscriptAt) {
      return false;
    }
    const lastTime = Date.parse(lastTranscriptAt);
    if (Number.isNaN(lastTime)) {
      return false;
    }
    const withinWindow = now.getTime() - lastTime <= 4000;
    if (!withinWindow) {
      return false;
    }
    const normalizedCurrent =
      this.normalizeTranscriptForDuplicateCheck(transcript);
    const normalizedLast =
      this.normalizeTranscriptForDuplicateCheck(lastTranscript);
    if (!normalizedCurrent || !normalizedLast) {
      return false;
    }
    return normalizedLast === normalizedCurrent;
  }

  private normalizeTranscriptForDuplicateCheck(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private normalizeNameCandidate(value: string): string {
    const cleaned = this.sanitizationService
      .sanitizeText(value)
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, " ");
    const stripped = this.stripNameFillers(cleaned);
    const normalized = this.sanitizationService.normalizeWhitespace(stripped);
    if (!normalized) {
      return "";
    }
    return this.toTitleCase(normalized);
  }

  private extractNameCandidateDeterministic(transcript: string): string | null {
    const cleaned = this.sanitizationService.sanitizeText(transcript);
    if (!cleaned) {
      return null;
    }
    if (/\d/.test(transcript)) {
      return null;
    }
    const tokenPattern =
      "([A-Za-z][A-Za-z'\\-]*(?:\\s+[A-Za-z][A-Za-z'\\-]*){0,2})";
    const patterns = [
      new RegExp(`\\bmy name is\\s+${tokenPattern}`, "i"),
      new RegExp(`\\bthis is\\s+${tokenPattern}`, "i"),
      new RegExp(`\\bi am\\s+${tokenPattern}`, "i"),
      new RegExp(`\\bi'?m\\s+${tokenPattern}`, "i"),
      new RegExp(`\\bname is\\s+${tokenPattern}`, "i"),
      new RegExp(`\\bit'?s\\s+${tokenPattern}`, "i"),
    ];
    for (const pattern of patterns) {
      const match = cleaned.match(pattern);
      if (!match || !match[1]) {
        continue;
      }
      const normalized = this.normalizeNameCandidate(match[1]);
      if (this.isValidNameCandidate(normalized)) {
        return normalized;
      }
    }
    const spelled = this.extractSpelledNameCandidate(cleaned);
    if (spelled) {
      return spelled;
    }
    const direct = this.normalizeNameCandidate(cleaned);
    if (!this.isValidNameCandidate(direct)) {
      return null;
    }
    return this.isLikelyNameCandidate(direct) ? direct : null;
  }

  private parseSpelledNameParts(transcript: string): {
    firstName: string | null;
    lastName?: string;
    letterCount: number;
    reason?: "no_letters" | "too_short" | "too_long";
  } {
    const cleaned = transcript.toUpperCase().replace(/[^A-Z\s]/g, " ");
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const letters: string[] = [];
    let startIndex = -1;
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      if (/^[A-Z]$/.test(token)) {
        if (startIndex < 0) {
          startIndex = index;
        }
        letters.push(token);
      } else if (letters.length >= 3) {
        break;
      } else {
        letters.length = 0;
        startIndex = -1;
      }
      index += 1;
    }
    if (letters.length === 0) {
      const hasLongTokens = tokens.some((token) => token.length > 4);
      const shortTokens = tokens.filter(
        (token) => token.length >= 2 && token.length <= 4,
      );
      if (
        !hasLongTokens &&
        shortTokens.length >= 2 &&
        shortTokens.length <= 6
      ) {
        const joinedShort = shortTokens.join("");
        if (joinedShort.length >= 3 && joinedShort.length <= 12) {
          const firstName = this.toTitleCase(joinedShort.toLowerCase());
          return {
            firstName,
            letterCount: joinedShort.length,
          };
        }
      }
      return { firstName: null, letterCount: 0, reason: "no_letters" };
    }
    if (letters.length < 3) {
      return {
        firstName: null,
        letterCount: letters.length,
        reason: "too_short",
      };
    }
    if (letters.length > 12) {
      return {
        firstName: null,
        letterCount: letters.length,
        reason: "too_long",
      };
    }
    const joined = letters.join("").toLowerCase();
    const firstName = this.toTitleCase(joined);
    const remainderIndex =
      startIndex >= 0 ? startIndex + letters.length : index;
    const remaining = tokens
      .slice(remainderIndex)
      .filter((token) => token.length > 1);
    const rawLastName = remaining[0];
    const normalizedLastName = rawLastName
      ? this.toTitleCase(rawLastName.toLowerCase())
      : null;
    const lastName =
      normalizedLastName && this.isValidLastNameToken(normalizedLastName)
        ? normalizedLastName
        : undefined;
    return { firstName, lastName, letterCount: letters.length };
  }

  private isValidLastNameToken(value: string): boolean {
    return /^[A-Za-z][A-Za-z'-]*$/.test(value) && value.length >= 2;
  }

  private extractSpelledNameCandidate(transcript: string): string | null {
    const parsed = this.parseSpelledNameParts(transcript);
    if (!parsed.firstName) {
      return null;
    }
    const candidate = parsed.lastName
      ? `${parsed.firstName} ${parsed.lastName}`
      : parsed.firstName;
    return this.isValidNameCandidate(candidate) ? candidate : null;
  }

  private isValidNameCandidate(candidate: string): boolean {
    const tokens = candidate.split(" ").filter(Boolean);
    if (tokens.length < 1 || tokens.length > 3) {
      return false;
    }
    return tokens.every((token) => /^[A-Za-z][A-Za-z'-]*$/.test(token));
  }

  private isLikelyNameCandidate(candidate: string): boolean {
    const blocked = new Set([
      "hello",
      "hi",
      "hey",
      "there",
      "this",
      "that",
      "you",
      "your",
      "me",
      "my",
      "the",
      "yes",
      "yeah",
      "yep",
      "yup",
      "yah",
      "ya",
      "yuh",
      "yellow",
      "yello",
      "no",
      "nope",
      "correct",
      "incorrect",
      "right",
      "ok",
      "okay",
      "maybe",
      "sure",
      "acting",
      "act",
      "up",
      "issue",
      "problem",
      "help",
      "from",
      "buggy",
      "slow",
      "down",
      "bye",
      "goodbye",
    ]);
    return candidate
      .toLowerCase()
      .split(" ")
      .filter(Boolean)
      .every((token) => !blocked.has(token));
  }

  private isNameFragment(candidate: string): boolean {
    const normalized = this.sanitizationService.normalizeWhitespace(
      this.stripNameFillers(candidate.toLowerCase()),
    );
    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length === 0) {
      return true;
    }
    return tokens[0].length <= 2;
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

  private shouldPromptForNameSpelling(
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>,
    candidate: string | null,
  ): boolean {
    if (!candidate) {
      return false;
    }
    if ((nameState.spellPromptCount ?? 0) > 0) {
      return false;
    }
    const tokenCount = candidate.split(" ").filter(Boolean).length;
    const lowConfidence = (nameState.lastConfidence ?? 1) < 0.8;
    const repeatedCorrections = (nameState.corrections ?? 0) >= 2;
    const fragment = this.isNameFragment(candidate);
    if (repeatedCorrections || fragment) {
      return true;
    }
    return lowConfidence && tokenCount <= 1;
  }

  private shouldRepromptForLowConfidenceName(
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>,
    candidate: string | null,
  ): boolean {
    if (!candidate) {
      return false;
    }
    const promptCount = nameState.spellPromptCount ?? 0;
    if (promptCount >= 2) {
      return false;
    }
    const tokenCount = candidate.split(" ").filter(Boolean).length;
    const confidence = nameState.lastConfidence;
    const lowConfidence =
      typeof confidence === "number" && confidence >= 0 && confidence < 0.35;
    const fragment = this.isNameFragment(candidate);
    if (fragment) {
      return true;
    }
    return tokenCount <= 1 && lowConfidence && !nameState.firstNameSpelled;
  }

  private buildNameClarificationPrompt(candidate: string | null): string {
    const normalizedCandidate = candidate
      ? this.sanitizationService.normalizeWhitespace(candidate)
      : "";
    if (normalizedCandidate) {
      return `I want to make sure I got your name right. I heard ${normalizedCandidate}. Please say your full first and last name.`;
    }
    return "I want to make sure I got your name right. Please say your full first and last name.";
  }

  private isLikelyAddressInputForName(transcript: string): boolean {
    if (!transcript) {
      return false;
    }
    const normalized = this.normalizeAddressCandidate(transcript);
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
    const stripped = this.stripAddressLeadIn(normalized);
    return this.isLikelyAddressCandidate(stripped);
  }

  private isLikelyAddressCandidate(candidate: string): boolean {
    if (!candidate) {
      return false;
    }
    const normalized = candidate.toLowerCase();
    const hasStreetSuffix =
      /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|pl|place|cir|circle)\b/.test(
        normalized,
      );
    const hasZip = /\b\d{5}(?:-\d{4})?\b/.test(normalized);
    const hasDigit = /\d/.test(normalized);
    if (hasZip) {
      return true;
    }
    if (hasDigit && hasStreetSuffix) {
      return true;
    }
    if (!hasDigit && hasStreetSuffix) {
      const tokens = normalized.split(/\s+/).filter(Boolean);
      return tokens.length >= 2;
    }
    return false;
  }

  private isLikelyHouseNumberOnly(value: string): boolean {
    if (!value) {
      return false;
    }
    const compact = value.replace(/\s+/g, "");
    return /^[0-9]{1,6}[A-Za-z]?$/.test(compact);
  }

  private isLikelyStreetOnly(value: string): boolean {
    if (!value) {
      return false;
    }
    if (/\d/.test(value)) {
      return false;
    }
    return /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|pl|place|cir|circle)\b/i.test(
      value,
    );
  }

  private normalizeAddressCandidate(value: string): string {
    const cleaned = this.sanitizationService.sanitizeText(value);
    return this.sanitizationService.normalizeWhitespace(cleaned);
  }

  private stripAddressLeadIn(value: string): string {
    if (!value) {
      return "";
    }
    const trimmed = this.sanitizationService.normalizeWhitespace(value);
    const withoutAddressPrefix = trimmed.replace(
      /^(?:my\s+address\s+is|the\s+address\s+is|address\s+is|service\s+address\s+is)\s+/i,
      "",
    );
    return withoutAddressPrefix.replace(/^(?:it is|it's)\s+/i, "").trim();
  }

  private isEquivalentAddressCandidate(
    leftValue: string,
    rightValue: string,
  ): boolean {
    const normalize = (value: string) =>
      this.normalizeAddressCandidate(value)
        .toLowerCase()
        .replace(/[\s,.-]+/g, " ")
        .trim();
    const left = normalize(leftValue);
    const right = normalize(rightValue);
    return Boolean(left && right && left === right);
  }

  private normalizeAddressComponent(
    value: string | null | undefined,
  ): string | null {
    if (!value) {
      return null;
    }
    const cleaned = this.sanitizationService.sanitizeText(value);
    const normalized = this.sanitizationService.normalizeWhitespace(cleaned);
    return normalized || null;
  }

  private compactAddressParts(parts: {
    houseNumber?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  }): {
    houseNumber?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } {
    const compact: {
      houseNumber?: string | null;
      street?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
    } = {};
    if (parts.houseNumber) {
      compact.houseNumber = parts.houseNumber;
    }
    if (parts.street) {
      compact.street = parts.street;
    }
    if (parts.city) {
      compact.city = parts.city;
    }
    if (parts.state) {
      compact.state = parts.state;
    }
    if (parts.zip) {
      compact.zip = parts.zip;
    }
    return compact;
  }

  private mergeAddressParts(
    current: ReturnType<ConversationsService["getVoiceAddressState"]>,
    extracted: {
      houseNumber?: string | null;
      street?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
    },
  ) {
    return {
      houseNumber: extracted.houseNumber ?? current.houseNumber ?? null,
      street: extracted.street ?? current.street ?? null,
      city: extracted.city ?? current.city ?? null,
      state: extracted.state ?? current.state ?? null,
      zip: extracted.zip ?? current.zip ?? null,
    };
  }

  private buildAddressCandidateFromParts(parts: {
    houseNumber?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  }): string | null {
    const line1 = [parts.houseNumber, parts.street].filter(Boolean).join(" ");
    const locality = [parts.city, parts.state, parts.zip]
      .filter(Boolean)
      .join(" ");
    const combined = [line1, locality].filter(Boolean).join(", ");
    return combined || null;
  }

  private extractAddressPartsFromCandidate(candidate: string): {
    houseNumber?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } {
    const normalized = this.normalizeAddressCandidate(candidate);
    if (!normalized) {
      return {};
    }
    const tokens = normalized.replace(/,/g, " , ").split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      return {};
    }
    const normalizedTokens = tokens.map((token) =>
      this.stripLocalityToken(token.toLowerCase()),
    );
    let zipIndex = normalizedTokens.findIndex((token) =>
      /^\d{5}(?:-\d{4})?$/.test(token),
    );
    if (zipIndex === 0 && tokens.length === 1) {
      zipIndex = -1;
    }
    const zip = zipIndex >= 0 ? tokens[zipIndex] : null;
    let stateIndex = -1;
    if (zipIndex > 0 && this.isStateToken(normalizedTokens[zipIndex - 1])) {
      stateIndex = zipIndex - 1;
    } else {
      stateIndex = normalizedTokens.findIndex((token) =>
        this.isStateToken(token),
      );
    }
    const stateToken = stateIndex >= 0 ? normalizedTokens[stateIndex] : null;
    const state = stateToken ? this.normalizeStateToken(stateToken) : null;
    const commaIndex = tokens.indexOf(",");
    const houseIndex = normalizedTokens.findIndex(
      (token, index) => /\d/.test(token) && index !== zipIndex,
    );
    const houseNumber = houseIndex >= 0 ? tokens[houseIndex] : null;

    const suffixes = new Set([
      "st",
      "street",
      "ave",
      "avenue",
      "rd",
      "road",
      "dr",
      "drive",
      "blvd",
      "boulevard",
      "ln",
      "lane",
      "ct",
      "court",
      "way",
      "pkwy",
      "parkway",
      "pl",
      "place",
      "cir",
      "circle",
    ]);

    let streetTokens: string[] = [];
    if (houseIndex >= 0) {
      const stopCandidates = [commaIndex, stateIndex, zipIndex].filter(
        (index) => index >= 0,
      );
      const stopIndex = stopCandidates.length
        ? Math.min(...stopCandidates)
        : tokens.length;
      if (houseIndex + 1 < stopIndex) {
        streetTokens = tokens.slice(houseIndex + 1, stopIndex);
      }
    }
    if (!streetTokens.length) {
      const suffixIndex = tokens.findIndex((token) =>
        suffixes.has(token.toLowerCase()),
      );
      if (suffixIndex >= 0) {
        streetTokens = tokens.slice(0, suffixIndex + 1);
      }
    }
    const street = streetTokens.length ? streetTokens.join(" ") : null;

    let cityTokens: string[] = [];
    if (commaIndex >= 0) {
      const endCandidates = [stateIndex, zipIndex].filter(
        (index) => index >= 0,
      );
      const endIndex = endCandidates.length
        ? Math.min(...endCandidates)
        : tokens.length;
      if (commaIndex + 1 < endIndex) {
        cityTokens = tokens.slice(commaIndex + 1, endIndex);
      }
    } else if (streetTokens.length) {
      const startIndex = streetTokens.length + (houseIndex >= 0 ? 1 : 0);
      const endCandidates = [stateIndex, zipIndex].filter(
        (index) => index >= 0,
      );
      const endIndex = endCandidates.length
        ? Math.min(...endCandidates)
        : tokens.length;
      if (startIndex < endIndex) {
        cityTokens = tokens.slice(startIndex, endIndex);
      }
    }
    const city = cityTokens.length ? cityTokens.join(" ") : null;

    return {
      ...(houseNumber ? { houseNumber } : {}),
      ...(street ? { street } : {}),
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(zip ? { zip } : {}),
    };
  }

  private hasStructuredAddressParts(
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>,
  ): boolean {
    return Boolean(
      addressState.houseNumber ||
      addressState.street ||
      addressState.city ||
      addressState.state ||
      addressState.zip,
    );
  }

  private getAddressMissingParts(
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>,
  ): {
    houseNumber: boolean;
    street: boolean;
    locality: boolean;
  } {
    const hasZip = Boolean(addressState.zip);
    const hasCityAndState = Boolean(addressState.city && addressState.state);
    return {
      houseNumber: !addressState.houseNumber,
      street: !addressState.street,
      locality: !(hasZip || hasCityAndState),
    };
  }

  private parseLocalityParts(value: string): {
    city: string | null;
    state: string | null;
    zip: string | null;
  } {
    const cleaned = this.normalizeAddressComponent(value);
    if (!cleaned) {
      return { city: null, state: null, zip: null };
    }
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const normalizedTokens = tokens.map((token) =>
      this.stripLocalityToken(token.toLowerCase()),
    );
    const zipIndex = normalizedTokens.findIndex((token) =>
      /^\d{5}(?:-\d{4})?$/.test(token),
    );
    const stateIndex = normalizedTokens.findIndex((token) =>
      this.isStateToken(token),
    );
    const zip = zipIndex >= 0 ? tokens[zipIndex] : null;
    const stateToken = stateIndex >= 0 ? normalizedTokens[stateIndex] : null;
    const state = stateToken ? this.normalizeStateToken(stateToken) : null;
    const cityTokens = tokens.filter(
      (_token, index) => index !== zipIndex && index !== stateIndex,
    );
    const city = cityTokens.length ? cityTokens.join(" ") : null;
    return { city, state, zip };
  }

  private extractAddressLocalityCorrection(value: string): {
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null {
    const normalized = this.normalizeAddressCandidate(value);
    if (!normalized) {
      return null;
    }
    const stripped = this.stripAddressLeadIn(normalized);
    const lowered = stripped.toLowerCase();
    const hasStreetSuffix =
      /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|pl|place|cir|circle)\b/.test(
        lowered,
      );
    const hasHouseAndTail = /^\d+\s+\S+/.test(stripped);
    if (hasStreetSuffix || hasHouseAndTail) {
      // Full address/correction candidates are handled by confirmation resolution.
      return null;
    }
    if (
      /^(yes|yeah|yep|yup|yah|ya|yuh|yellow|yello|correct|that's right|that is right|right|ok|okay|affirmative|no|nope|negative)$/i.test(
        stripped,
      )
    ) {
      return null;
    }
    const parsed = this.parseLocalityParts(stripped);
    const confirmationWords = new Set([
      "yes",
      "yeah",
      "yep",
      "yup",
      "yah",
      "ya",
      "yuh",
      "yellow",
      "yello",
      "correct",
      "right",
      "ok",
      "okay",
      "affirmative",
      "no",
      "nope",
      "negative",
    ]);
    const cityToken = parsed.city?.trim().toLowerCase() ?? "";
    const city =
      cityToken && !confirmationWords.has(cityToken) ? parsed.city : null;
    const hasSignal = Boolean(parsed.zip || parsed.state || (city && parsed.state));
    if (!hasSignal) {
      return null;
    }
    return {
      ...(city ? { city } : {}),
      ...(parsed.state ? { state: parsed.state } : {}),
      ...(parsed.zip ? { zip: parsed.zip } : {}),
    };
  }

  private normalizeStateToken(token: string): string {
    if (!token) {
      return "";
    }
    const cleaned = token.replace(/\s+/g, "");
    if (cleaned.length === 2) {
      return cleaned.toUpperCase();
    }
    return this.toTitleCase(cleaned.toLowerCase());
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
    if (this.hasStructuredAddressParts(addressState)) {
      const missing = this.getAddressMissingParts(addressState);
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
      if (this.isIncompleteAddress(addressState.candidate)) {
        return this.buildIncompleteAddressTwiml(
          addressState.candidate,
          strategy,
        );
      }
      if (this.isMissingLocality(addressState.candidate)) {
        return this.buildAddressLocalityPromptTwiml(strategy);
      }
      return this.buildAddressConfirmationTwiml(
        addressState.candidate,
        strategy,
      );
    }
    return this.buildAskAddressTwiml(strategy);
  }

  private isIncompleteAddress(candidate: string): boolean {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (normalized.length < 6) {
      return true;
    }
    const hasDigit = /\d/.test(normalized);
    const hasAlpha = /[A-Za-z]/.test(normalized);
    if (!hasDigit) {
      return true;
    }
    if (!hasAlpha) {
      return true;
    }
    if (/^\d+$/.test(normalized) || /^[A-Za-z\s]+$/.test(normalized)) {
      return true;
    }
    if (!/^\d+\s+\S+/.test(normalized)) {
      return true;
    }
    if (/\s[A-Za-z]\s*$/.test(normalized)) {
      return true;
    }
    if (/\.\.\.|\u2026/.test(normalized)) {
      return true;
    }
    const abbrevMatch = normalized.match(
      /\s([A-Za-z]{1,2})\s+(st|rd|dr|ave|blvd|ln|ct)\s*$/i,
    );
    if (abbrevMatch && abbrevMatch[1].length <= 2) {
      return true;
    }
    return false;
  }

  private isMissingLocality(candidate: string): boolean {
    const normalized = candidate.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    const tokens = normalized
      .split(" ")
      .filter(Boolean)
      .map((token) => this.stripLocalityToken(token));
    const zipIndex = this.findZipTokenIndex(tokens);
    if (zipIndex >= 0) {
      return false;
    }
    const stateIndex = this.findStateTokenIndex(tokens);
    if (stateIndex === null || stateIndex < 0) {
      return true;
    }
    const cityTokens = tokens.slice(
      Math.max(0, stateIndex - 3),
      stateIndex,
    );
    return !cityTokens.some((token) => this.isCityToken(token));
  }

  private findZipTokenIndex(tokens: string[]): number {
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (/^\d{5}(?:-\d{4})?$/.test(tokens[i])) {
        return i;
      }
    }
    return -1;
  }

  private findStateTokenIndex(tokens: string[]): number | null {
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (this.isStateToken(tokens[i])) {
        return i;
      }
    }
    return null;
  }

  private isStateToken(token: string): boolean {
    const states = new Set([
      "al",
      "ak",
      "az",
      "ar",
      "ca",
      "co",
      "ct",
      "de",
      "fl",
      "ga",
      "hi",
      "id",
      "il",
      "in",
      "ia",
      "ks",
      "ky",
      "la",
      "me",
      "md",
      "ma",
      "mi",
      "mn",
      "ms",
      "mo",
      "mt",
      "ne",
      "nv",
      "nh",
      "nj",
      "nm",
      "ny",
      "nc",
      "nd",
      "oh",
      "ok",
      "or",
      "pa",
      "ri",
      "sc",
      "sd",
      "tn",
      "tx",
      "ut",
      "vt",
      "va",
      "wa",
      "wv",
      "wi",
      "wy",
      "alabama",
      "alaska",
      "arizona",
      "arkansas",
      "california",
      "colorado",
      "connecticut",
      "delaware",
      "florida",
      "georgia",
      "hawaii",
      "idaho",
      "illinois",
      "indiana",
      "iowa",
      "kansas",
      "kentucky",
      "louisiana",
      "maine",
      "maryland",
      "massachusetts",
      "michigan",
      "minnesota",
      "mississippi",
      "missouri",
      "montana",
      "nebraska",
      "nevada",
      "newhampshire",
      "newjersey",
      "newmexico",
      "newyork",
      "northcarolina",
      "northdakota",
      "ohio",
      "oklahoma",
      "oregon",
      "pennsylvania",
      "rhodeisland",
      "southcarolina",
      "southdakota",
      "tennessee",
      "texas",
      "utah",
      "vermont",
      "virginia",
      "washington",
      "westvirginia",
      "wisconsin",
      "wyoming",
    ]);
    return states.has(token.replace(/\s+/g, ""));
  }

  private isCityToken(token: string): boolean {
    if (!token || /^\d+$/.test(token)) {
      return false;
    }
    const streetSuffixes = new Set([
      "st",
      "street",
      "rd",
      "road",
      "dr",
      "drive",
      "ave",
      "avenue",
      "blvd",
      "boulevard",
      "ln",
      "lane",
      "ct",
      "court",
      "way",
      "pkwy",
      "parkway",
      "pl",
      "place",
      "cir",
      "circle",
    ]);
    return !streetSuffixes.has(token);
  }

  private stripLocalityToken(token: string): string {
    return token.replace(/[^a-z0-9-]/gi, "");
  }

  private mergeAddressWithLocality(
    candidate: string,
    locality: string,
  ): string {
    const normalized = locality.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return candidate;
    }
    const lowerCandidate = candidate.toLowerCase();
    const lowerLocality = normalized.toLowerCase();
    if (lowerCandidate.includes(lowerLocality)) {
      return candidate;
    }
    return `${candidate} ${normalized}`.replace(/\s+/g, " ").trim();
  }

  private stripNameFillers(value: string): string {
    const leadingTokens = new Set([
      "um",
      "uh",
      "erm",
      "er",
      "hey",
      "hi",
      "hello",
    ]);
    let result = value.trim();
    let trimmed = true;
    while (trimmed) {
      trimmed = false;
      for (const token of leadingTokens) {
        if (result.startsWith(`${token} `)) {
          result = result.slice(token.length).trim();
          trimmed = true;
          break;
        }
      }
    }
    const fillers = [
      "my name is",
      "this is",
      "i am",
      "im",
      "i'm",
      "name is",
      "its",
      "it's",
    ];
    for (const filler of fillers) {
      if (result.startsWith(`${filler} `)) {
        result = result.slice(filler.length).trim();
        break;
      }
    }
    trimmed = true;
    while (trimmed) {
      trimmed = false;
      for (const token of leadingTokens) {
        if (result.startsWith(`${token} `)) {
          result = result.slice(token.length).trim();
          trimmed = true;
          break;
        }
      }
    }
    const trailingCourtesyTokens = new Set([
      "thanks",
      "thank",
      "you",
      "please",
      "sir",
      "maam",
      "mam",
    ]);
    let tokens = result.split(/\s+/).filter(Boolean);
    while (tokens.length > 1) {
      const tail = tokens[tokens.length - 1];
      if (!trailingCourtesyTokens.has(tail)) {
        break;
      }
      tokens = tokens.slice(0, -1);
    }
    result = tokens.join(" ");
    return result;
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
