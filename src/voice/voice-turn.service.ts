import { Inject, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { CommunicationChannel, TenantOrganization } from "@prisma/client";
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
type VoiceListeningField = "name" | "address" | "confirmation";
type VoiceListeningWindow = {
  field: VoiceListeningField;
  sourceEventId: string | null;
  expiresAt: string;
  targetField?: "name" | "address";
};
type TenantFeePolicy = {
  serviceFeeCents: number;
  emergencyFeeCents: number;
  creditWindowHours: number;
};

@Injectable()
export class VoiceTurnService {
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
    const speechResult = params.speechResult ?? null;
    const normalizedSpeech = speechResult
      ? speechResult.replace(/\s+/g, " ").trim()
      : "";
    if (!normalizedSpeech) {
      return this.replyWithTwiml(res, this.buildRepromptTwiml());
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
    const addressState =
      this.conversationsService.getVoiceAddressState(collectedData);
    const csrStrategy = this.selectCsrStrategy({
      conversation: updatedConversation ?? conversation,
      collectedData,
      nameState,
      addressState,
    });
    this.loggingService.log(
      {
        event: "voice.strategy_selected",
        tenantId: tenant.id,
        conversationId,
        strategy: csrStrategy,
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
    if (expectedField === "address" && !nameReady) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      expectedField = null;
    }
    if (!nameReady && (!expectedField || expectedField === "name")) {
      const existingIssueCandidate = this.getVoiceIssueCandidate(collectedData);
      const isOpeningTurn =
        !expectedField &&
        nameState.status === "MISSING" &&
        nameState.attemptCount === 0 &&
        !nameState.candidate.value &&
        !existingIssueCandidate?.value;
      if (isOpeningTurn) {
        const issueCandidate = this.normalizeIssueCandidate(normalizedSpeech);
        if (this.isLikelyIssueCandidate(issueCandidate)) {
          await this.conversationsService.updateVoiceIssueCandidate({
            tenantId: tenant.id,
            conversationId,
            issue: {
              value: issueCandidate,
              sourceEventId: currentEventId ?? "",
              createdAt: new Date().toISOString(),
            },
          });
          const followUp =
            "Got it—that's definitely something we want to address quickly. I'll take care of this for you. May I have your name, please?";
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "name",
            sourceEventId: currentEventId,
            twiml: this.buildSayGatherTwiml(
              this.applyCsrStrategy(csrStrategy, followUp),
            ),
          });
        }
        const openingCandidate =
          this.extractNameCandidateDeterministic(normalizedSpeech);
        if (
          openingCandidate &&
          this.isValidNameCandidate(openingCandidate) &&
          this.isLikelyNameCandidate(openingCandidate)
        ) {
          const nextNameState: typeof nameState = {
            ...nameState,
            candidate: {
              value: openingCandidate,
              sourceEventId: currentEventId,
              createdAt: new Date().toISOString(),
            },
            status: "CANDIDATE",
          };
          await this.conversationsService.updateVoiceNameState({
            tenantId: tenant.id,
            conversationId,
            nameState: nextNameState,
          });
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "confirmation",
            targetField: "name",
            sourceEventId: currentEventId,
            twiml: this.buildNameConfirmationTwiml(
              openingCandidate,
              csrStrategy,
            ),
          });
        }
        const sideQuestionReply = await this.buildSideQuestionReply(
          tenant.id,
          normalizedSpeech,
        );
        const followUp = sideQuestionReply
          ? `${sideQuestionReply} May I have your name, please?`
          : "Thanks for that. To get this started, may I have your name, please?";
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml: this.buildSayGatherTwiml(
            this.applyCsrStrategy(csrStrategy, followUp),
          ),
        });
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
        const followUp =
          "Got it—that's definitely something we want to address quickly. I'll take care of this for you. May I have your name, please?";
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml: this.buildSayGatherTwiml(
            this.applyCsrStrategy(csrStrategy, followUp),
          ),
        });
      }

      const sideQuestionReply = await this.buildSideQuestionReply(
        tenant.id,
        normalizedSpeech,
      );
      if (sideQuestionReply) {
        await this.callLogService.createVoiceAssistantLog({
          tenantId: tenant.id,
          conversationId,
          callSid,
          message: sideQuestionReply,
          occurredAt: new Date(),
          sourceEventId: currentEventId,
        });
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml: this.buildSayGatherTwiml(
            `${sideQuestionReply} Please say your full name.`,
          ),
        });
      }

      const duplicateMissing =
        !nameState.candidate.value &&
        nameState.candidate.sourceEventId === currentEventId;
      if (duplicateMissing) {
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml: this.buildAskNameTwiml(csrStrategy),
        });
      }
      const candidateForEvent =
        Boolean(nameState.candidate.value) &&
        nameState.candidate.sourceEventId === currentEventId;
      if (candidateForEvent && nameState.candidate.value) {
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "confirmation",
          targetField: "name",
          sourceEventId: currentEventId,
          twiml: this.buildNameConfirmationTwiml(
            nameState.candidate.value,
            csrStrategy,
          ),
        });
      }
      if (nameState.candidate.value) {
        if (
          this.isSoftConfirmationEligible(
            "name",
            nameState.candidate.value,
            normalizedSpeech,
            confidence,
          )
        ) {
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "confirmation",
            targetField: "name",
            sourceEventId: currentEventId,
            twiml: this.buildNameSoftConfirmationTwiml(
              nameState.candidate.value,
              csrStrategy,
            ),
          });
        }
        const resolution = this.resolveConfirmation(
          normalizedSpeech,
          nameState.candidate.value,
          "name",
        );
        if (resolution.outcome === "CONFIRM") {
          if (!nameState.locked) {
            const confirmedAt = new Date().toISOString();
            const nextNameState: typeof nameState = {
              ...nameState,
              status: "CANDIDATE",
              locked: true,
            };
            await this.conversationsService.updateVoiceNameState({
              tenantId: tenant.id,
              conversationId,
              nameState: nextNameState,
              confirmation: {
                field: "name",
                value: nameState.candidate.value,
                confirmedAt,
                sourceEventId: currentEventId ?? "",
                channel: "VOICE",
              },
            });
            this.loggingService.log(
              {
                event: "voice.field_confirmed",
                field: "name",
                tenantId: tenant.id,
                conversationId,
                callSid,
                sourceEventId: currentEventId,
              },
              VoiceTurnService.name,
            );
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            timeoutSec: 8,
            twiml: this.buildSayGatherTwiml(
              "Thanks. Please say your full address.",
              { timeout: 8 },
            ),
          });
        }
        if (resolution.outcome === "REJECT") {
          const nextAttempt = nameState.attemptCount + 1;
          const shouldFailClosed = nextAttempt >= 3;
          const nextNameState: typeof nameState = {
            ...nameState,
            candidate: {
              value: null,
              sourceEventId: currentEventId,
              createdAt: null,
            },
            status: "MISSING",
            attemptCount: nextAttempt,
          };
          await this.conversationsService.updateVoiceNameState({
            tenantId: tenant.id,
            conversationId,
            nameState: nextNameState,
          });
          if (shouldFailClosed) {
            await this.clearVoiceListeningWindow({
              tenantId: tenant.id,
              conversationId,
            });
            return this.replyWithSmsHandoff({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              displayName,
              reason: "name_attempts_exceeded",
            });
          }
          if (nextAttempt >= 1) {
            return this.replyWithListeningWindow({
              res,
              tenantId: tenant.id,
              conversationId,
              field: "name",
              sourceEventId: currentEventId,
              twiml: this.buildSpellNameTwiml(csrStrategy),
            });
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "name",
            sourceEventId: currentEventId,
            twiml: this.buildAskNameTwiml(csrStrategy),
          });
        }
        if (
          resolution.outcome === "REPLACE_CANDIDATE" &&
          resolution.candidate
        ) {
          const nextAttempt = nameState.attemptCount + 1;
          const shouldFailClosed = nextAttempt >= 3;
          const nextNameState: typeof nameState = {
            ...nameState,
            candidate: {
              value: resolution.candidate,
              sourceEventId: currentEventId,
              createdAt: new Date().toISOString(),
            },
            status: "CANDIDATE",
            attemptCount: nextAttempt,
          };
          await this.conversationsService.updateVoiceNameState({
            tenantId: tenant.id,
            conversationId,
            nameState: nextNameState,
          });
          if (shouldFailClosed) {
            await this.clearVoiceListeningWindow({
              tenantId: tenant.id,
              conversationId,
            });
            return this.replyWithSmsHandoff({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              displayName,
              reason: "name_attempts_exceeded",
            });
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "confirmation",
            targetField: "name",
            sourceEventId: currentEventId,
            twiml: this.buildNameConfirmationTwiml(
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
          targetField: "name",
          sourceEventId: currentEventId,
          twiml: this.buildYesNoRepromptTwiml(csrStrategy),
        });
      }

      if (this.isLikelyAddressInputForName(normalizedSpeech)) {
        const nextAttempt = nameState.attemptCount + 1;
        const shouldFailClosed = nextAttempt >= 3;
        const nextNameState: typeof nameState = {
          ...nameState,
          candidate: {
            value: null,
            sourceEventId: currentEventId,
            createdAt: null,
          },
          status: "MISSING",
          attemptCount: nextAttempt,
        };
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: nextNameState,
        });
        if (shouldFailClosed) {
          await this.clearVoiceListeningWindow({
            tenantId: tenant.id,
            conversationId,
          });
          return this.replyWithSmsHandoff({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            reason: "name_attempts_exceeded",
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml: this.buildSpellNameTwiml(csrStrategy),
        });
      }

      if (!expectedField) {
        const sideQuestionReply = await this.buildSideQuestionReply(
          tenant.id,
          normalizedSpeech,
        );
        if (sideQuestionReply) {
          await this.callLogService.createVoiceAssistantLog({
            tenantId: tenant.id,
            conversationId,
            callSid,
            message: sideQuestionReply,
            occurredAt: new Date(),
            sourceEventId: currentEventId,
          });
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "name",
            sourceEventId: currentEventId,
            twiml: this.buildSayGatherTwiml(
              `${sideQuestionReply} Now, please say your full name.`,
            ),
          });
        }
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
      if (!validatedCandidate) {
        const nextAttempt = nameState.attemptCount + 1;
        const shouldFailClosed = nextAttempt >= 3;
        const nextNameState: typeof nameState = {
          ...nameState,
          candidate: {
            value: null,
            sourceEventId: currentEventId,
            createdAt: null,
          },
          status: "MISSING",
          attemptCount: nextAttempt,
        };
        await this.conversationsService.updateVoiceNameState({
          tenantId: tenant.id,
          conversationId,
          nameState: nextNameState,
        });
        if (shouldFailClosed) {
          await this.clearVoiceListeningWindow({
            tenantId: tenant.id,
            conversationId,
          });
          return this.replyWithSmsHandoff({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            reason: "name_attempts_exceeded",
          });
        }
        if (nextAttempt >= 1) {
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "name",
            sourceEventId: currentEventId,
            twiml: this.buildSpellNameTwiml(csrStrategy),
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml: this.buildAskNameTwiml(csrStrategy),
        });
      }

      const nextNameState: typeof nameState = {
        ...nameState,
        candidate: {
          value: validatedCandidate,
          sourceEventId: currentEventId,
          createdAt: new Date().toISOString(),
        },
        status: "CANDIDATE",
      };
      await this.conversationsService.updateVoiceNameState({
        tenantId: tenant.id,
        conversationId,
        nameState: nextNameState,
      });
      return this.replyWithListeningWindow({
        res,
        tenantId: tenant.id,
        conversationId,
        field: "confirmation",
        targetField: "name",
        sourceEventId: currentEventId,
        twiml: this.buildNameConfirmationTwiml(validatedCandidate, csrStrategy),
      });
    }

    const addressReady =
      Boolean(addressState.confirmed) ||
      this.isVoiceFieldReady(addressState.locked, addressState.confirmed);
    if (expectedField === "address" && addressReady) {
      await this.clearVoiceListeningWindow({
        tenantId: tenant.id,
        conversationId,
      });
      expectedField = null;
    }
    if (!addressReady && (!expectedField || expectedField === "address")) {
      if (addressState.status === "FAILED") {
        await this.clearVoiceListeningWindow({
          tenantId: tenant.id,
          conversationId,
        });
        return this.replyWithSmsHandoff({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          displayName,
          reason: "address_failed",
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
          twiml: this.buildAskAddressTwiml(csrStrategy),
        });
      }

      if (addressState.needsLocality && addressState.candidate) {
        const normalizedLocality =
          this.normalizeAddressCandidate(normalizedSpeech);
        const hasDigits = /\d/.test(normalizedLocality);
        const mergedCandidate = hasDigits
          ? normalizedLocality
          : this.mergeAddressWithLocality(
              addressState.candidate,
              normalizedLocality,
            );
        const nextAddressState: typeof addressState = {
          ...addressState,
          candidate: mergedCandidate || addressState.candidate,
          needsLocality: false,
          sourceEventId: currentEventId,
        };
        await this.conversationsService.updateVoiceAddressState({
          tenantId: tenant.id,
          conversationId,
          addressState: nextAddressState,
        });
        if (this.isIncompleteAddress(nextAddressState.candidate ?? "")) {
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            twiml: this.buildIncompleteAddressTwiml(
              nextAddressState.candidate ?? "",
              csrStrategy,
            ),
          });
        }
        if (this.isMissingLocality(nextAddressState.candidate ?? "")) {
          return this.handleMissingLocalityPrompt({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            candidate: nextAddressState.candidate ?? "",
            addressState: nextAddressState,
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
            nextAddressState.candidate ?? "",
            csrStrategy,
          ),
        });
      }

      const candidateForEvent =
        Boolean(addressState.candidate) &&
        addressState.sourceEventId === currentEventId;
      if (candidateForEvent && addressState.candidate) {
        if (this.isIncompleteAddress(addressState.candidate)) {
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            twiml: this.buildIncompleteAddressTwiml(
              addressState.candidate,
              csrStrategy,
            ),
          });
        }
        if (this.isMissingLocality(addressState.candidate)) {
          return this.handleMissingLocalityPrompt({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            candidate: addressState.candidate,
            addressState,
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
          if (this.isIncompleteAddress(addressState.candidate)) {
            return this.replyWithListeningWindow({
              res,
              tenantId: tenant.id,
              conversationId,
              field: "address",
              sourceEventId: currentEventId,
              twiml: this.buildIncompleteAddressTwiml(
                addressState.candidate,
                csrStrategy,
              ),
            });
          }
          if (this.isMissingLocality(addressState.candidate)) {
            return this.handleMissingLocalityPrompt({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              candidate: addressState.candidate,
              addressState,
              currentEventId,
              displayName,
              strategy: csrStrategy,
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
            this.loggingService.log(
              {
                event: "voice.address_capture_failed",
                tenantId: tenant.id,
                conversationId,
                callSid,
                attemptCount: nextAttempt,
                candidate: addressState.candidate,
                confidence: addressState.confidence,
              },
              VoiceTurnService.name,
            );
            await this.clearVoiceListeningWindow({
              tenantId: tenant.id,
              conversationId,
            });
            return this.replyWithSmsHandoff({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              displayName,
              reason: "address_attempts_exceeded",
            });
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            twiml: this.buildAskAddressTwiml(csrStrategy),
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
            await this.clearVoiceListeningWindow({
              tenantId: tenant.id,
              conversationId,
            });
            return this.replyWithSmsHandoff({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              displayName,
              reason: "address_attempts_exceeded",
            });
          }
          if (this.isMissingLocality(resolution.candidate)) {
            return this.handleMissingLocalityPrompt({
              res,
              tenantId: tenant.id,
              conversationId,
              callSid,
              candidate: resolution.candidate,
              addressState: nextAddressState,
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
      const candidateAddress = this.normalizeAddressCandidate(
        extracted?.address ?? "",
      );
      const minConfidence = this.config.voiceAddressMinConfidence ?? 0.7;
      const extractedConfidence =
        typeof extracted?.confidence === "number"
          ? extracted.confidence
          : undefined;
      const meetsConfidence =
        typeof extractedConfidence === "number" &&
        extractedConfidence >= minConfidence;
      const isIncomplete =
        !candidateAddress || this.isIncompleteAddress(candidateAddress);
      if (isIncomplete || !meetsConfidence) {
        const nextAttempt = addressState.attemptCount + 1;
        const shouldFailClosed = nextAttempt >= 2;
        const nextAddressState: typeof addressState = {
          ...addressState,
          candidate: candidateAddress || null,
          status: shouldFailClosed ? "FAILED" : "CANDIDATE",
          attemptCount: nextAttempt,
          confidence: extractedConfidence,
          sourceEventId: currentEventId,
        };
        await this.conversationsService.updateVoiceAddressState({
          tenantId: tenant.id,
          conversationId,
          addressState: nextAddressState,
        });
        if (shouldFailClosed) {
          this.loggingService.log(
            {
              event: "voice.address_capture_failed",
              tenantId: tenant.id,
              conversationId,
              callSid,
              attemptCount: nextAttempt,
              candidate: candidateAddress,
              confidence: extractedConfidence,
            },
            VoiceTurnService.name,
          );
          await this.clearVoiceListeningWindow({
            tenantId: tenant.id,
            conversationId,
          });
          return this.replyWithSmsHandoff({
            res,
            tenantId: tenant.id,
            conversationId,
            callSid,
            displayName,
            reason: "address_attempts_exceeded",
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "address",
          sourceEventId: currentEventId,
          twiml: this.buildIncompleteAddressTwiml(
            candidateAddress,
            csrStrategy,
          ),
        });
      }

      const nextAddressState: typeof addressState = {
        ...addressState,
        candidate: candidateAddress,
        status: "CANDIDATE",
        confidence: extractedConfidence,
        sourceEventId: currentEventId,
      };
      await this.conversationsService.updateVoiceAddressState({
        tenantId: tenant.id,
        conversationId,
        addressState: nextAddressState,
      });
      if (this.isMissingLocality(candidateAddress)) {
        return this.handleMissingLocalityPrompt({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          candidate: candidateAddress,
          addressState: nextAddressState,
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
        if (this.shouldGatherMore(safeReply)) {
          return this.replyWithTwiml(res, this.buildSayGatherTwiml(safeReply));
        }
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
    await this.logVoiceAssistantMessages(twiml);
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
    const core = "Sorry about that. Please say your full name.";
    return this.buildSayGatherTwiml(
      this.applyCsrStrategy(
        strategy,
        this.withPrefix("Thanks, just so we're on the same page. ", core),
      ),
    );
  }

  private buildSpellNameTwiml(strategy?: CsrStrategy): string {
    const core =
      "I'm having trouble with the name. Please spell your first name, then say your last name.";
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
      this.loggingService.log(
        {
          event: "voice.address_capture_failed",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          attemptCount: nextAttempt,
          candidate: params.candidate,
          confidence: params.addressState.confidence,
        },
        VoiceTurnService.name,
      );
      await this.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      return this.replyWithSmsHandoff({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        reason: "address_locality_attempts_exceeded",
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

  private isLikelyIssueCandidate(value: string): boolean {
    if (!value) {
      return false;
    }
    const normalized = value.toLowerCase();
    if (normalized.length < 6) {
      return false;
    }
    return /(furnace|heat|heating|cold|ac|air conditioning|cooling|no heat|no hot|leak|leaking|water|burst|clog|drain|electrical|power|spark|smell|smoke|gas|broken|not working|stopped working|went out|went down|blizzard)/.test(
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
      );
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
    if (field !== "name" && field !== "address" && field !== "confirmation") {
      return null;
    }
    const expiresAt =
      typeof window.expiresAt === "string" ? window.expiresAt : null;
    if (!expiresAt) {
      return null;
    }
    const targetField =
      window.targetField === "name" || window.targetField === "address"
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

  private isListeningWindowExpired(
    window: VoiceListeningWindow,
    now: Date,
  ): boolean {
    const expiresAt = Date.parse(window.expiresAt);
    return Number.isNaN(expiresAt) || expiresAt <= now.getTime();
  }

  private getExpectedListeningField(
    window: VoiceListeningWindow | null,
  ): "name" | "address" | null {
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
    return false;
  }

  private buildListeningWindowReprompt(params: {
    window: VoiceListeningWindow | null;
    nameState: ReturnType<ConversationsService["getVoiceNameState"]>;
    addressState: ReturnType<ConversationsService["getVoiceAddressState"]>;
    strategy?: CsrStrategy;
  }): string {
    const expectedField = this.getExpectedListeningField(params.window);
    if (expectedField === "name") {
      if (params.nameState.candidate.value) {
        return this.buildNameConfirmationTwiml(
          params.nameState.candidate.value,
          params.strategy,
        );
      }
      if (params.nameState.attemptCount >= 1) {
        return this.buildSpellNameTwiml(params.strategy);
      }
      return this.buildAskNameTwiml(params.strategy);
    }
    if (expectedField === "address") {
      if (params.addressState.candidate) {
        if (this.isIncompleteAddress(params.addressState.candidate)) {
          return this.buildIncompleteAddressTwiml(
            params.addressState.candidate,
            params.strategy,
          );
        }
        if (this.isMissingLocality(params.addressState.candidate)) {
          return this.buildAddressLocalityPromptTwiml(params.strategy);
        }
        return this.buildAddressConfirmationTwiml(
          params.addressState.candidate,
          params.strategy,
        );
      }
      return this.buildAskAddressTwiml(params.strategy);
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
    targetField?: "name" | "address";
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

    return "Happy to help. First, I just need a couple of quick details.";
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

  private extractSpelledNameCandidate(transcript: string): string | null {
    const lowered = transcript.toLowerCase().replace(/[^a-z\s'-]/g, " ");
    const stripped = lowered.replace(
      /\b(spell|spelling|first|last|name|is|my|its|it's)\b/g,
      " ",
    );
    const tokens = stripped.split(/\s+/).filter(Boolean);
    if (tokens.length < 3) {
      return null;
    }
    const letters: string[] = [];
    let index = 0;
    while (index < tokens.length && tokens[index].length === 1) {
      letters.push(tokens[index]);
      index += 1;
    }
    if (letters.length < 3) {
      return null;
    }
    const remaining = tokens.slice(index).filter((token) => token.length > 1);
    if (remaining.length === 0) {
      return null;
    }
    const firstName = letters.join("");
    const lastName = remaining[0];
    const candidate = this.normalizeNameCandidate(`${firstName} ${lastName}`);
    return this.isValidNameCandidate(candidate) ? candidate : null;
  }

  private isValidNameCandidate(candidate: string): boolean {
    const tokens = candidate.split(" ").filter(Boolean);
    if (tokens.length < 2 || tokens.length > 3) {
      return false;
    }
    return tokens.every((token) => /^[A-Za-z][A-Za-z'-]*$/.test(token));
  }

  private isLikelyNameCandidate(candidate: string): boolean {
    const blocked = new Set(["hello", "hi", "hey", "there"]);
    return candidate
      .toLowerCase()
      .split(" ")
      .filter(Boolean)
      .every((token) => !blocked.has(token));
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
    let result = value;
    for (const filler of fillers) {
      if (result.startsWith(filler + " ")) {
        result = result.slice(filler.length).trim();
        break;
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
