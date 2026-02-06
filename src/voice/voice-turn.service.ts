import { Inject, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { CommunicationChannel, Prisma, TenantOrganization } from "@prisma/client";
import appConfig, { type AppConfig } from "../config/app.config";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { ConversationsService } from "../conversations/conversations.service";
import { CallLogService } from "../logging/call-log.service";
import { LoggingService } from "../logging/logging.service";
import { AiService } from "../ai/ai.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { CsrStrategy, CsrStrategySelector } from "./csr-strategy.selector";
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
  | "callback";
type VoiceListeningWindow = {
  field: VoiceListeningField;
  sourceEventId: string | null;
  expiresAt: string;
  targetField?: "name" | "address" | "booking" | "callback";
};
type TenantFeePolicy = {
  serviceFeeCents: number;
  emergencyFeeCents: number;
  creditWindowHours: number;
};

@Injectable()
export class VoiceTurnService {
  private readonly lastResponseByCall = new Map<
    string,
    { twiml: string; at: number }
  >();

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
  }): Promise<string> {
    return this.processTurn({
      res: undefined,
      tenant: params.tenant,
      callSid: params.callSid,
      speechResult: params.speechResult ?? null,
      confidence: params.confidence ?? null,
      requestId: params.requestId,
    });
  }

  private async processTurn(params: {
    res?: Response;
    tenant: TenantOrganization;
    callSid: string;
    speechResult?: string | null;
    confidence?: string | number | null;
    requestId?: string;
  }) {
    const { tenant, callSid, res } = params;

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
    const listeningWindowSnapshot =
      this.getVoiceListeningWindow(collectedDataSnapshot);
    const expectedFieldSnapshot =
      this.getExpectedListeningField(listeningWindowSnapshot);
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
    const nameState =
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
    const nameReady =
      Boolean(nameState.confirmed.value) ||
      this.isVoiceFieldReady(nameState.locked, nameState.confirmed.value);
    if (expectedField === "name" && nameReady) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      expectedField = null;
    }
    if (expectedField === "address" && !nameReady && nameState.attemptCount === 0) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      expectedField = null;
    }
    if (expectedField === "booking") {
      const isYes =
        this.isAffirmativeUtterance(normalizedSpeech) ||
        this.isBookingIntent(normalizedSpeech);
      const isNo = this.isNegativeUtterance(normalizedSpeech);
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
      const isYes = this.isAffirmativeUtterance(normalizedSpeech);
      const isNo = this.isNegativeUtterance(normalizedSpeech);
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
    if (this.isFrustrationRequest(normalizedSpeech)) {
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
    // Name flow map (current):
    // - Yes/no prompts: buildNameConfirmationTwiml/buildNameSoftConfirmationTwiml/buildYesNoRepromptTwiml.
    // - Confirmation parsing: resolveConfirmation + extractReplacementCandidate.
    // - Progression gate: nameReady (locked/confirmed) before moving to address.
    // - Listening window gate: voiceListeningWindow field "confirmation" with targetField "name".
    if (!nameReady && (!expectedField || expectedField === "name")) {
      const existingIssueCandidate = this.getVoiceIssueCandidate(collectedData);
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
        const base = "Please say your full address.";
        if (preface && preface.trim()) {
          return this.applyCsrStrategy(
            csrStrategy,
            `${preface.trim()} ${base}`,
          );
        }
        return this.applyCsrStrategy(csrStrategy, `Thanks. ${base}`);
      };
      const replyWithAddressPrompt = async (preface?: string) =>
        this.replyWithListeningWindow({
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
      const recordNameAttemptIfNeeded = async () => {
        if (nameState.attemptCount > 0) {
          return;
        }
        const nextNameState: typeof nameState = {
          ...nameState,
          attemptCount: 1,
        };
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: nextNameState,
        });
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
      const turnIndex = voiceTurnCount;
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
        const nextNameState: typeof nameState = {
          ...nameState,
          candidate: {
            value: candidate,
            sourceEventId: currentEventId,
            createdAt: new Date().toISOString(),
          },
          status: "CANDIDATE",
          attemptCount: Math.max(1, nameState.attemptCount),
          corrections:
            typeof options?.corrections === "number"
              ? options.corrections
              : nameState.corrections ?? 0,
          lastConfidence:
            typeof options?.lastConfidence === "number"
              ? options.lastConfidence
              : nameState.lastConfidence ?? null,
          firstNameSpelled:
            typeof options?.firstNameSpelled === "string"
              ? options.firstNameSpelled
              : nameState.firstNameSpelled ?? null,
          spellPromptedAt:
            options && "spellPromptedAt" in options
              ? options.spellPromptedAt ?? null
              : nameState.spellPromptedAt ?? null,
          spellPromptedTurnIndex:
            options && "spellPromptedTurnIndex" in options
              ? options.spellPromptedTurnIndex ?? null
              : nameState.spellPromptedTurnIndex ?? null,
          spellPromptCount:
            typeof options?.spellPromptCount === "number"
              ? options.spellPromptCount
              : nameState.spellPromptCount ?? 0,
        };
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: nextNameState,
        });
        return nextNameState;
      };
      const buildNameFollowUp = (issueSummary?: string | null) => {
        const trimmedIssue =
          issueSummary?.trim().replace(/[.?!]+$/, "") ?? "";
        const issueAck = trimmedIssue ? `I heard ${trimmedIssue}. ` : "";
        return `Thanks. ${issueAck}What's your full name?`
          .replace(/\s+/g, " ")
          .trim();
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
        const resolvedIssue =
          issueSummary ?? existingIssueSummary ?? null;
        const trimmedIssue =
          resolvedIssue?.trim().replace(/[.?!]+$/, "") ?? "";
        const issueAck = trimmedIssue
          ? `I heard ${trimmedIssue}.`
          : "";
        const preface = issueAck ? `${thanks} ${issueAck}` : thanks;
        return replyWithAddressPrompt(preface);
      };
      const spellingResponseCandidate = this.normalizeNameCandidate(
        normalizedSpeech,
      );
      const shouldHandleSpellingResponse =
        Boolean(nameState.spellPromptedAt) &&
        (typeof nameState.spellPromptedTurnIndex !== "number" ||
          turnIndex > nameState.spellPromptedTurnIndex ||
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
        const openingCandidate =
          this.extractNameCandidateDeterministic(normalizedSpeech);
        const hasOpeningName =
          openingCandidate &&
          this.isValidNameCandidate(openingCandidate) &&
          this.isLikelyNameCandidate(openingCandidate);
        const issueCandidate = this.normalizeIssueCandidate(normalizedSpeech);
        const hasIssue = this.isLikelyIssueCandidate(issueCandidate);
        if (hasIssue) {
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
          : "Thanks. What's your full name?";
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
        (await this.aiService.extractNameCandidate(
          tenant.id,
          normalizedSpeech,
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
          if (
            this.shouldPromptForNameSpelling(
              nameState,
              existingCandidate,
            )
          ) {
            return promptForNameSpelling(existingCandidate, nameState);
          }
          return acknowledgeNameAndMoveOn(existingCandidate);
        }
        const isCorrection =
          Boolean(existingCandidate) && validatedCandidate !== existingCandidate;
        const nextCorrections = isCorrection
          ? (nameState.corrections ?? 0) + 1
          : nameState.corrections ?? 0;
        const nextNameState = await storeProvisionalName(validatedCandidate, {
          lastConfidence: confidence ?? null,
          corrections: nextCorrections,
        });
        return maybePromptForSpelling(validatedCandidate, nextNameState);
      }
      if (nameState.candidate.value) {
        if (
          this.shouldPromptForNameSpelling(
            nameState,
            nameState.candidate.value,
          )
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
        const normalized = this.normalizeConfirmationUtterance(normalizedSpeech);
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

    const addressDeferred = Boolean(addressState.smsConfirmNeeded);
    const addressReady =
      Boolean(addressState.confirmed) ||
      this.isVoiceFieldReady(addressState.locked, addressState.confirmed) ||
      addressDeferred;
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
        const hasDigits = /\d/.test(normalizedLocality);
        const mergedCandidate = hasDigits
          ? normalizedLocality
          : this.mergeAddressWithLocality(
              addressState.candidate,
              normalizedLocality,
            );
        const mergedParts = this.mergeAddressParts(
          addressState,
          localityParts,
        );
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
              addressState,
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
            addressState.candidate,
            csrStrategy,
          ),
        });
      }

      if (addressState.candidate) {
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
                addressState,
                csrStrategy,
              ),
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
            const includeFees = this.shouldDiscloseFees({
              nameState,
              addressState,
              collectedData,
            });
            return this.handleVoiceIssueCandidate({
              res,
              tenantId: tenant.id,
              callSid,
              conversationId,
              issueCandidate: issueCandidate.value,
              currentEventId,
              displayName,
              includeFees,
              isEmergency: this.isUrgencyEmergency(collectedData),
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
            });
          }
          const hasStructured = this.hasStructuredAddressParts(nextAddressState);
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
          await this.callLogService.createVoiceAssistantLog({
            tenantId: tenant.id,
            conversationId,
            callSid,
            message: addressQuestionReply,
            occurredAt: new Date(),
            sourceEventId: currentEventId,
          });
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            timeoutSec: 8,
            twiml: this.buildSayGatherTwiml(
              `${addressQuestionReply} Now, please say your full service address.`,
              { timeout: 8 },
            ),
          });
        }
      }

      const extracted = await this.aiService.extractAddressCandidate(
        tenant.id,
        normalizedSpeech,
      );
      const normalizedAddress = this.normalizeAddressCandidate(
        extracted?.address ?? "",
      );
      const seedCandidate =
        normalizedAddress || addressState.candidate || null;
      const extractedParts = {
        houseNumber: this.normalizeAddressComponent(
          extracted?.houseNumber ?? null,
        ),
        street: this.normalizeAddressComponent(extracted?.street ?? null),
        city: this.normalizeAddressComponent(extracted?.city ?? null),
        state: this.normalizeAddressComponent(extracted?.state ?? null),
        zip: this.normalizeAddressComponent(extracted?.zip ?? null),
      };
      const derivedParts = seedCandidate
        ? this.extractAddressPartsFromCandidate(seedCandidate)
        : {};
      const mergedParts = this.mergeAddressParts(addressState, {
        ...derivedParts,
        ...extractedParts,
      });
      const candidateAddress =
        normalizedAddress ||
        this.buildAddressCandidateFromParts(mergedParts) ||
        addressState.candidate ||
        null;
      const minConfidence = this.config.voiceAddressMinConfidence ?? 0.7;
      const extractedConfidence =
        typeof extracted?.confidence === "number"
          ? extracted.confidence
          : undefined;
      const meetsConfidence =
        typeof extractedConfidence === "number" &&
        extractedConfidence >= minConfidence;
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
        const includeFees = this.shouldDiscloseFees({
          nameState,
          addressState,
          collectedData,
        });
        return this.handleVoiceIssueCandidate({
          res,
          tenantId: tenant.id,
          callSid,
          conversationId,
          issueCandidate: issueCandidate.value,
          currentEventId,
          displayName,
          includeFees,
          isEmergency: this.isUrgencyEmergency(collectedData),
        });
      }
      return this.replyWithTwiml(
        res,
        this.buildSayGatherTwiml(
          "Perfect, thanks for confirming that. Now tell me what's been going on with the system.",
        ),
      );
    }

    try {
      const aiResult = await this.aiService.triage(
        tenant.id,
        callSid,
        normalizedSpeech,
        {
          conversationId,
          channel: CommunicationChannel.VOICE,
        },
      );
      if (aiResult.status === "reply" && "reply" in aiResult) {
        const safeReply = this.capAiReply(aiResult.reply ?? "");
        await this.callLogService.createVoiceAssistantLog({
          tenantId: tenant.id,
          conversationId,
          callSid,
          message: safeReply,
          occurredAt: new Date(),
          sourceEventId: currentEventId,
        });
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
        await this.callLogService.createVoiceAssistantLog({
          tenantId: tenant.id,
          conversationId,
          callSid,
          message,
          occurredAt: new Date(),
          sourceEventId: currentEventId,
        });
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
    return this.buildTwiml(
      "Voice intake is currently unavailable. Please try again later.",
    );
  }

  private unroutableTwiml(): string {
    return this.buildTwiml("We're unable to route your call at this time.");
  }

  public buildConsentMessage(displayName: string): string {
    const tenantLabel = displayName?.trim() || "our team";
    return `Thank you for calling ${tenantLabel}. This is Signmons. This call may be transcribed and handled by automated systems for service and quality purposes. By continuing, you consent to this process. How may I help you?`;
  }

  public buildConsentTwiml(displayName: string): string {
    const actionUrl = this.buildWebhookUrl("/api/voice/turn");
    const composed = this.buildConsentMessage(displayName);
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      composed,
    )}</Say><Gather input="speech" action="${this.escapeXml(
      actionUrl,
    )}" method="POST" timeout="5" speechTimeout="auto"/></Response>`;
  }

  private buildSayGatherTwiml(
    message: string,
    options?: { timeout?: number; bargeIn?: boolean },
  ): string {
    const actionUrl = this.buildWebhookUrl("/api/voice/turn");
    const timeout = options?.timeout ?? 5;
    const bargeIn = options?.bargeIn ? ' bargeIn="true"' : "";
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Gather input="speech" action="${this.escapeXml(
      actionUrl,
    )}" method="POST" timeout="${timeout}" speechTimeout="auto"${bargeIn}/></Response>`;
  }

  private buildRepromptTwiml(strategy?: CsrStrategy): string {
    const actionUrl = this.buildWebhookUrl("/api/voice/turn");
    const message = this.applyCsrStrategy(
      strategy,
      "Sorry, I didn't catch that. Please say that again.",
    );
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Gather input="speech" action="${this.escapeXml(
      actionUrl,
    )}" method="POST" timeout="5" speechTimeout="auto"/></Response>`;
  }

  private buildNameConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const firstName = candidate.split(" ").filter(Boolean)[0] ?? "";
    const thanks = firstName ? `Thanks, ${firstName}. ` : "Thanks. ";
    const core = `${thanks}I heard ${candidate}. If that's right, say 'yes'. Otherwise, say your full name again.`;
    const message = this.applyCsrStrategy(
      strategy,
      this.withPrefix("Got it. ", core),
    );
    return this.buildSayGatherTwiml(message, { bargeIn: true });
  }

  private buildNameSoftConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const firstName = candidate.split(" ").filter(Boolean)[0] ?? "";
    const thanks = firstName ? `Thanks, ${firstName}. ` : "Thanks. ";
    const core = `${thanks}I heard ${candidate}. If that's right, say 'yes'. Otherwise, say your full name again.`;
    const message = this.applyCsrStrategy(
      strategy,
      this.withPrefix("Got it. ", core),
    );
    return this.buildSayGatherTwiml(message, { bargeIn: true });
  }

  private buildAskNameTwiml(strategy?: CsrStrategy): string {
    const core = "What's your full name?";
    return this.buildSayGatherTwiml(
      this.applyCsrStrategy(
        strategy,
        this.withPrefix("Thanks. ", core),
      ),
    );
  }

  private buildSpellNameTwiml(strategy?: CsrStrategy): string {
    const core = "Thanks—how do you spell your first name?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core));
  }

  private buildAskSmsNumberTwiml(strategy?: CsrStrategy): string {
    const core = "What's the best number to text updates to?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core));
  }

  private buildTakeYourTimeTwiml(
    field: "name" | "address" | "sms_phone",
    strategy?: CsrStrategy,
  ): string {
    let question = "How can I help?";
    let timeout = 5;
    if (field === "name") {
      question = "What's your full name?";
    } else if (field === "address") {
      question = "Please say your full service address.";
      timeout = 8;
    } else if (field === "sms_phone") {
      question = "What's the best number to text updates to?";
    }
    const message = `Sure—take your time. ${question}`.trim();
    return this.buildSayGatherTwiml(
      this.applyCsrStrategy(strategy, message),
      { timeout },
    );
  }

  private buildBookingPromptTwiml(strategy?: CsrStrategy): string {
    const core = "Would you like to book a visit?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core));
  }

  private buildCallbackOfferTwiml(strategy?: CsrStrategy): string {
    const core = "I can have a dispatcher call you back. Is that okay?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core));
  }

  private buildAddressConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const core = `Thanks. I heard ${candidate}. I just need the full address to send the right tech. If that's right, say 'yes'. Otherwise, say the full address.`;
    const message = this.applyCsrStrategy(
      strategy,
      this.withPrefix("Got it. ", core),
    );
    return this.buildSayGatherTwiml(message, { timeout: 8, bargeIn: true });
  }

  private buildAddressSoftConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const core = `Thanks. I heard ${candidate}. I just need the full address to send the right tech. If that's right, say 'yes'. Otherwise, say the full address.`;
    const message = this.applyCsrStrategy(
      strategy,
      this.withPrefix("Got it. ", core),
    );
    return this.buildSayGatherTwiml(message, { timeout: 8, bargeIn: true });
  }

  private buildAddressLocalityPromptTwiml(strategy?: CsrStrategy): string {
    const core = "Thanks. What city, state, and ZIP code is that in?";
    const message = this.applyCsrStrategy(strategy, core);
    return this.buildSayGatherTwiml(message, { timeout: 8 });
  }

  private buildAskAddressTwiml(strategy?: CsrStrategy): string {
    const core = "Sorry about that. Please say your full service address.";
    return this.buildSayGatherTwiml(
      this.applyCsrStrategy(strategy, this.withPrefix("Thanks. ", core)),
      { timeout: 8 },
    );
  }

  private buildIncompleteAddressTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    const tokens = normalized ? normalized.split(" ") : [];
    const numberIndex = tokens.findIndex((token) => /\d/.test(token));
    if (numberIndex === -1) {
      return this.buildSayGatherTwiml(
        this.applyCsrStrategy(
          strategy,
          this.withPrefix(
            "Thanks. ",
            "I didn't catch the house number. Please repeat the full street name and city.",
          ),
        ),
      );
    }
    const numberToken = tokens[numberIndex];
    const prefixTokens = tokens.slice(numberIndex + 1, numberIndex + 4);
    const prefix = prefixTokens.length ? ` ${prefixTokens.join(" ")}` : "";
    const core = `I heard: ${numberToken}${prefix}... That seems incomplete. Please repeat the full street name and city.`;
    const message = this.applyCsrStrategy(
      strategy,
      this.withPrefix("Thanks. ", core),
    );
    return this.buildSayGatherTwiml(message, { timeout: 8 });
  }

  private buildYesNoRepromptTwiml(strategy?: CsrStrategy): string {
    return this.buildSayGatherTwiml(
      this.applyCsrStrategy(
        strategy,
        this.withPrefix(
          "Sorry, I didn't catch that. ",
          "Please say 'yes' or say the correct details.",
        ),
      ),
      { bargeIn: true },
    );
  }

  private buildWebhookUrl(path: string): string {
    const baseUrl = this.config.twilioWebhookBaseUrl?.replace(/\/$/, "");
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  private buildSmsHandoffMessage(): string {
    return "Perfect. To make sure everything's accurate, I'll send you a quick text to confirm your name and details. Once that's done, we'll move forward.";
  }

  private buildSmsHandoffMessageWithFees(params: {
    feePolicy: TenantFeePolicy | null;
    isEmergency: boolean;
  }): string {
    const { serviceFee, emergencyFee, creditWindowHours } =
      this.getTenantFeeConfig(params.feePolicy);
    const creditWindowLabel =
      creditWindowHours === 1 ? "1 hour" : `${creditWindowHours} hours`;
    const serviceLine =
      typeof serviceFee === "number"
        ? `The service fee is ${this.formatFeeAmount(
            serviceFee,
          )}, and it's credited toward repairs if you approve within ${creditWindowLabel}.`
        : `A service fee applies, and it's credited toward repairs if you approve within ${creditWindowLabel}.`;
    const emergencyLine = params.isEmergency
      ? typeof emergencyFee === "number"
        ? `Because this is urgent, there's an additional ${this.formatFeeAmount(
            emergencyFee,
          )} emergency fee. The emergency fee is not credited.`
        : "Because this is urgent, an additional emergency fee applies. The emergency fee is not credited."
      : "";
    const approvalTarget = params.isEmergency ? "the fees" : "the service fee";
    const smsLine = `I'll text you to confirm your details and approve ${approvalTarget} so we can move forward.`;
    return `Perfect. ${serviceLine}${emergencyLine ? ` ${emergencyLine}` : ""} ${smsLine}`.trim();
  }

  private buildSmsHandoffMessageForContext(params: {
    feePolicy: TenantFeePolicy | null;
    includeFees: boolean;
    isEmergency: boolean;
  }): string {
    if (!params.includeFees) {
      return this.buildSmsHandoffMessage();
    }
    return this.buildSmsHandoffMessageWithFees({
      feePolicy: params.feePolicy,
      isEmergency: params.isEmergency,
    });
  }

  private buildClosingTwiml(displayName: string, message: string): string {
    const tenantLabel = displayName?.trim();
    const prefix = tenantLabel
      ? `Thanks for calling. ${tenantLabel}. `
      : "Thanks for calling. ";
    return this.buildTwiml(`${prefix}${message}`);
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
    const conversation = await this.conversationsService.getConversationById({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    if (conversation?.collectedData) {
      const phoneState = this.conversationsService.getVoiceSmsPhoneState(
        conversation.collectedData,
      );
      if (!phoneState.confirmed) {
        await this.conversationsService.updateVoiceSmsHandoff({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          handoff: {
            reason: params.reason,
            messageOverride: params.messageOverride ?? null,
            createdAt: new Date().toISOString(),
          },
        });
        await this.conversationsService.updateVoiceSmsPhoneState({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          phoneState: {
            ...phoneState,
            lastPromptedAt: new Date().toISOString(),
          },
        });
        const sourceEventId = getRequestContext()?.sourceEventId ?? null;
        this.loggingService.log(
          {
            event: "voice.sms_phone_prompted",
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            callSid: params.callSid,
          },
          VoiceTurnService.name,
        );
        return this.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "sms_phone",
          sourceEventId,
          twiml: this.buildAskSmsNumberTwiml(),
        });
      }
    }

    this.logVoiceOutcome({
      outcome: "sms_handoff",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });
    return this.replyWithTwiml(
      params.res,
      this.buildClosingTwiml(
        params.displayName,
        params.messageOverride ?? this.buildSmsHandoffMessage(),
      ),
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
  }) {
    const nextAddressState: typeof params.addressState = {
      ...params.addressState,
      status: "FAILED",
      smsConfirmNeeded: true,
      needsLocality: false,
      sourceEventId: params.currentEventId ?? params.addressState.sourceEventId ?? null,
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
      return this.handleVoiceIssueCandidate({
        res: params.res,
        tenantId: params.tenantId,
        callSid: params.callSid,
        conversationId: params.conversationId,
        issueCandidate: issueCandidate.value,
        currentEventId: params.currentEventId,
        displayName: params.displayName,
        includeFees,
        isEmergency: this.isUrgencyEmergency(params.collectedData),
      });
    }

    const message =
      "No problem—I'll confirm the address by text after we finish. What's been going on with the system?";
    return this.replyWithTwiml(
      params.res,
      this.buildSayGatherTwiml(
        this.applyCsrStrategy(params.strategy, message),
      ),
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

  private normalizeIssueCandidate(value: string): string {
    const cleaned = this.sanitizationService.sanitizeText(value);
    return this.sanitizationService.normalizeWhitespace(cleaned);
  }

  private buildIssueAcknowledgement(value: string): string | null {
    const cleaned = this.sanitizationService.sanitizeText(value);
    if (!cleaned) {
      return null;
    }
    const normalized = this.sanitizationService.normalizeWhitespace(cleaned);
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
    let summary = this.sanitizationService.normalizeWhitespace(slice).replace(
      /[.?!]+$/,
      "",
    );
    summary = summary.replace(/^my\s+/i, "your ");
    const lowerSummary = summary.toLowerCase();
    if (
      !lowerSummary.startsWith("your ") &&
      (lowerSummary.startsWith("furnace") ||
        lowerSummary.startsWith("ac") ||
        lowerSummary.startsWith("air conditioning") ||
        lowerSummary.startsWith("heating") ||
        lowerSummary.startsWith("cooling"))
    ) {
      summary = `your ${summary}`;
    }
    return summary || null;
  }

  private isLikelyIssueCandidate(value: string): boolean {
    if (!value) {
      return false;
    }
    const normalized = value.toLowerCase();
    if (normalized.length < 6) {
      return false;
    }
    return /(furnace|heat|heating|cold|ac|air conditioning|cooling|no heat|no hot|leak|leaking|water|burst|clog|drain|electrical|power|spark|smell|smoke|gas|broken|not working|stopped working|went out|went down|blizzard|acting up|issue|problem)/.test(
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
      );
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
  }) {
    try {
      const aiResult = await this.aiService.triage(
        params.tenantId,
        params.callSid,
        params.issueCandidate,
        {
          conversationId: params.conversationId,
          channel: CommunicationChannel.VOICE,
        },
      );
      if (aiResult.status === "reply" && "reply" in aiResult) {
        const safeReply = this.capAiReply(aiResult.reply ?? "");
        await this.callLogService.createVoiceAssistantLog({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          message: safeReply,
          occurredAt: new Date(),
          sourceEventId: params.currentEventId ?? undefined,
        });
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

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private unescapeXml(value: string): string {
    return value
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");
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
  ): Promise<TenantFeePolicy | null> {
    try {
      return await this.tenantsService.getTenantFeePolicy(tenantId);
    } catch {
      return null;
    }
  }

  private getTenantFeeConfig(policy: TenantFeePolicy | null): {
    serviceFee: number | null;
    emergencyFee: number | null;
    creditWindowHours: number;
  } {
    if (!policy) {
      return {
        serviceFee: null,
        emergencyFee: null,
        creditWindowHours: 24,
      };
    }
    const creditWindowHours =
      typeof policy.creditWindowHours === "number" &&
      policy.creditWindowHours > 0
        ? policy.creditWindowHours
        : 24;
    const emergencyFee =
      typeof policy.emergencyFeeCents === "number" &&
      policy.emergencyFeeCents > 0
        ? policy.emergencyFeeCents / 100
        : null;
    return {
      serviceFee: policy.serviceFeeCents / 100,
      emergencyFee,
      creditWindowHours,
    };
  }

  private formatFeeAmount(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
  }

  private isUrgencyEmergency(collectedData: unknown): boolean {
    if (!collectedData || typeof collectedData !== "object") {
      return false;
    }
    const data = collectedData as Record<string, unknown>;
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
    const prefix = this.getCsrPrefix(strategy);
    if (!prefix) {
      return message;
    }
    const normalizedMessage = message.trim().toLowerCase();
    const normalizedPrefix = prefix.toLowerCase();
    if (
      normalizedMessage.includes(normalizedPrefix) ||
      normalizedMessage.startsWith("thanks") ||
      normalizedMessage.startsWith("got it") ||
      normalizedMessage.startsWith("sorry")
    ) {
      return message;
    }
    return `${prefix} ${message}`.trim();
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
    const callSid = context.callSid as string;
    const now = Date.now();
    const last = this.lastResponseByCall.get(callSid);
    if (last && last.twiml === twiml && now - last.at < 2000) {
      return true;
    }
    this.lastResponseByCall.set(callSid, { twiml, at: now });
    return false;
  }

  private extractSayMessages(twiml: string): string[] {
    const results: string[] = [];
    const regex = /<Say>(.*?)<\/Say>/g;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(twiml)) !== null) {
      const raw = this.unescapeXml(match[1] ?? "");
      const trimmed = raw.trim();
      if (trimmed) {
        results.push(trimmed);
      }
    }
    return results;
  }

  private withPrefix(prefix: string | undefined, message: string): string {
    if (!prefix) {
      return message;
    }
    const trimmed = message.trim();
    const normalized = trimmed.toLowerCase();
    const normalizedPrefix = prefix.trim().toLowerCase();
    if (normalized.startsWith(normalizedPrefix)) {
      return message;
    }
    return `${prefix}${message}`;
  }

  private getCsrPrefix(strategy: CsrStrategy | undefined): string {
    switch (strategy) {
      case CsrStrategy.OPENING:
        return "Thanks for calling.";
      case CsrStrategy.EMPATHY:
        return "I'm here to help.";
      case CsrStrategy.URGENCY_FRAMING:
        return "We'll treat this as urgent so we can help quickly.";
      case CsrStrategy.NEXT_STEP_POSITIONING:
        return "Here's what we'll do next.";
      default:
        return "";
    }
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
      field !== "sms_phone"
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
      window.targetField === "callback"
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
    expectedField?: VoiceListeningField | null,
  ): boolean {
    const normalized = transcript.toLowerCase().trim();
    if (!normalized) {
      return true;
    }
    if (this.isSlowDownRequest(normalized) || this.isFrustrationRequest(normalized)) {
      return false;
    }
    if (/\d/.test(normalized)) {
      return false;
    }
    if (
      (expectedField === "confirmation" ||
        expectedField === "booking" ||
        expectedField === "callback") &&
      /^(yes|yeah|yep|no|nope|correct|that's right|that is right)$/i.test(
        normalized,
      )
    ) {
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
  ): "name" | "address" | "sms_phone" | "booking" | "callback" | null {
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
    if (expectedField === "booking" || expectedField === "callback") {
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
    targetField?: "name" | "address" | "booking" | "callback";
  }) {
    const timeoutSec = params.timeoutSec ?? 8;
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
      "correct",
      "that's right",
      "that is right",
      "this one",
      "this number",
      "same number",
      "use this",
      "use this number",
    ];
    if (directMatches.includes(normalizedUtterance)) {
      return true;
    }
    return (
      normalizedUtterance.includes("this number") ||
      normalizedUtterance.includes("same number") ||
      normalizedUtterance.includes("this one") ||
      normalizedUtterance.startsWith("use this")
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

    return null;
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
    await this.callLogService.createVoiceAssistantLog({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      message: bookingMessage,
      occurredAt: new Date(),
      sourceEventId: params.sourceEventId ?? undefined,
    });
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
    return /\b(human|agent|representative|supervisor|manager|person|talk to|speak to|operator|buggy|repeating|not listening|ridiculous|frustrated|annoying)\b/.test(
      normalized,
    );
  }

  private isAffirmativeUtterance(transcript: string): boolean {
    const normalized = this.normalizeConfirmationUtterance(transcript);
    return [
      "yes",
      "yeah",
      "yep",
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
    ].includes(normalized);
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
    const withinWindow = now.getTime() - lastTime <= 2000;
    if (!withinWindow) {
      return false;
    }
    return (
      lastTranscript.trim().toLowerCase() === transcript.trim().toLowerCase()
    );
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
      if (!hasLongTokens && shortTokens.length >= 2 && shortTokens.length <= 6) {
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
    const remainderIndex = startIndex >= 0 ? startIndex + letters.length : index;
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

  private isLikelyAddressInputForName(transcript: string): boolean {
    if (!transcript) {
      return false;
    }
    const normalized = transcript.toLowerCase();
    if (/\d/.test(normalized)) {
      return true;
    }
    return /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|pl|place|cir|circle)\b/.test(
      normalized,
    );
  }

  private normalizeAddressCandidate(value: string): string {
    const cleaned = this.sanitizationService.sanitizeText(value);
    return this.sanitizationService.normalizeWhitespace(cleaned);
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
      houseNumber:
        extracted.houseNumber ?? current.houseNumber ?? null,
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
    const tokens = normalized
      .replace(/,/g, " , ")
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) {
      return {};
    }
    let zipIndex = tokens.findIndex((token) =>
      /^\d{5}(?:-\d{4})?$/.test(token),
    );
    if (zipIndex === 0 && tokens.length === 1) {
      zipIndex = -1;
    }
    const zip = zipIndex >= 0 ? tokens[zipIndex] : null;
    let stateIndex = -1;
    if (
      zipIndex > 0 &&
      /^[A-Za-z]{2}$/.test(tokens[zipIndex - 1])
    ) {
      stateIndex = zipIndex - 1;
    } else {
      stateIndex = tokens.findIndex((token) => /^[A-Za-z]{2}$/.test(token));
    }
    const state = stateIndex >= 0 ? tokens[stateIndex].toUpperCase() : null;
    const commaIndex = tokens.indexOf(",");
    const houseIndex = tokens.findIndex((token) => /\d/.test(token));
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
      const startIndex =
        streetTokens.length + (houseIndex >= 0 ? 1 : 0);
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
    return {
      houseNumber: !addressState.houseNumber,
      street: !addressState.street,
      locality:
        !addressState.city || !addressState.state || !addressState.zip,
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
    const zipIndex = tokens.findIndex((token) =>
      /^\d{5}(?:-\d{4})?$/.test(token),
    );
    const stateIndex = tokens.findIndex((token) =>
      /^[A-Za-z]{2}$/.test(token),
    );
    const zip = zipIndex >= 0 ? tokens[zipIndex] : null;
    const state =
      stateIndex >= 0 ? tokens[stateIndex].toUpperCase() : null;
    const cityTokens = tokens.filter(
      (_token, index) => index !== zipIndex && index !== stateIndex,
    );
    const city = cityTokens.length ? cityTokens.join(" ") : null;
    return { city, state, zip };
  }

  private buildAskHouseNumberTwiml(
    strategy?: CsrStrategy,
    street?: string | null,
  ): string {
    const prefix = street ? `I heard ${street}. ` : "";
    const core = `${prefix}What's the house number?`;
    return this.buildSayGatherTwiml(
      this.applyCsrStrategy(strategy, core),
      { timeout: 8 },
    );
  }

  private buildAskStreetTwiml(
    strategy?: CsrStrategy,
    houseNumber?: string | null,
  ): string {
    const prefix = houseNumber ? `I heard ${houseNumber}. ` : "";
    const core = `${prefix}What's the street name?`;
    return this.buildSayGatherTwiml(
      this.applyCsrStrategy(strategy, core),
      { timeout: 8 },
    );
  }

  private buildAddressPromptForState(
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>,
    strategy?: CsrStrategy,
  ): string {
    if (this.hasStructuredAddressParts(addressState)) {
      const missing = this.getAddressMissingParts(addressState);
      if (missing.houseNumber && addressState.street) {
        return this.buildAskHouseNumberTwiml(
          strategy,
          addressState.street,
        );
      }
      if (missing.street && addressState.houseNumber) {
        return this.buildAskStreetTwiml(
          strategy,
          addressState.houseNumber,
        );
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
    if (zipIndex < 0) {
      return true;
    }
    const stateIndex = this.findStateTokenIndex(tokens);
    let effectiveStateIndex: number | null = stateIndex;
    const beforeZip = zipIndex - 1;
    if (beforeZip < 0) {
      return true;
    }
    if (this.isStateToken(tokens[beforeZip])) {
      effectiveStateIndex = beforeZip;
    } else {
      return true;
    }
    if (effectiveStateIndex === null || effectiveStateIndex < 0) {
      return true;
    }
    const cityTokens = tokens.slice(
      Math.max(0, effectiveStateIndex - 3),
      effectiveStateIndex,
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
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Hangup/></Response>`;
  }
}
