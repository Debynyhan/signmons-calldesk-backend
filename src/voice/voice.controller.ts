import {
  Controller,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { validateRequest } from "twilio";
import { CommunicationChannel } from "@prisma/client";
import appConfig, { type AppConfig } from "../config/app.config";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { ConversationsService } from "../conversations/conversations.service";
import { CallLogService } from "../logging/call-log.service";
import { LoggingService } from "../logging/logging.service";
import { AiService } from "../ai/ai.service";
import { setRequestContextData } from "../common/context/request-context";
import { SanitizationService } from "../sanitization/sanitization.service";

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

@Controller("api/voice")
export class VoiceController {
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
  ) {}

  @Post("inbound")
  async handleInbound(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.replyWithTwiml(res, this.disabledTwiml());
    }
    const toNumber = this.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    const callSid = this.extractCallSid(req);
    if (!callSid) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    const requestId = this.getRequestId(req);
    const callerPhone = this.extractFromNumber(req) ?? undefined;
    await this.conversationsService.ensureVoiceConsentConversation({
      tenantId: tenant.id,
      callSid,
      requestId,
      callerPhone,
    });
    return this.replyWithTwiml(
      res,
      this.buildConsentTwiml(),
    );
  }

  @Post("turn")
  async handleTurn(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.replyWithTwiml(res, this.disabledTwiml());
    }
    const toNumber = this.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    const callSid = this.extractCallSid(req);
    if (!callSid) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    const conversation = await this.conversationsService.getVoiceConversationByCallSid(
      {
        tenantId: tenant.id,
        callSid,
      },
    );
    const consentGranted = Boolean(
      (conversation?.collectedData as { voiceConsent?: { granted?: boolean } })
        ?.voiceConsent?.granted,
    );
    if (!consentGranted) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }

    if (!conversation) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }

    const now = new Date();
    const turnState = await this.conversationsService.incrementVoiceTurn({
      tenantId: tenant.id,
      conversationId: conversation.id,
      now,
    });

    if (!turnState) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }

    const maxTurns = Math.max(1, this.config.voiceMaxTurns ?? 6);
    const maxDurationSec = Math.max(30, this.config.voiceMaxDurationSec ?? 180);
    const startedAt = new Date(turnState.voiceStartedAt);
    const elapsedSec = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
    if (turnState.voiceTurnCount > maxTurns || elapsedSec > maxDurationSec) {
      return this.replyWithTwiml(
        res,
        this.buildTwiml("Thanks for calling. We'll follow up shortly."),
      );
    }
    const speechResult = this.extractSpeechResult(req);
    const normalizedSpeech = speechResult
      ? speechResult.replace(/\s+/g, " ").trim()
      : "";
    if (!normalizedSpeech) {
      return this.replyWithTwiml(res, this.buildRepromptTwiml());
    }
    if (this.isDuplicateTranscript(conversation?.collectedData, normalizedSpeech, now)) {
      return this.replyWithTwiml(
        res,
        this.buildSayGatherTwiml(
          "Thanks, I heard that. Please continue.",
        ),
      );
    }
    const confidence = this.normalizeConfidence(this.extractConfidence(req));
    const updatedConversation = await this.conversationsService.updateVoiceTranscript({
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
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    if (!transcriptEventId) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }

    const requestId = this.getRequestId(req);
    setRequestContextData({
      tenantId: tenant.id,
      requestId,
      callSid,
      conversationId,
      channel: "VOICE",
    });

    const collectedData =
      updatedConversation?.collectedData ?? conversation.collectedData;
    const nameState = this.conversationsService.getVoiceNameState(collectedData);
    const addressState =
      this.conversationsService.getVoiceAddressState(collectedData);
    const currentEventId = transcriptEventId;
    let listeningWindow = this.getVoiceListeningWindow(collectedData);
    if (
      listeningWindow &&
      this.shouldClearListeningWindow(listeningWindow, now, nameState, addressState)
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
          twiml: this.buildAskNameTwiml(),
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
          twiml: this.buildNameConfirmationTwiml(nameState.candidate.value),
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
              VoiceController.name,
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
            return this.replyWithTwiml(
              res,
              this.buildTwiml(
                "Thanks. We'll follow up by text to confirm your details.",
              ),
            );
          }
          if (nextAttempt >= 2) {
            return this.replyWithListeningWindow({
              res,
              tenantId: tenant.id,
              conversationId,
              field: "name",
              sourceEventId: currentEventId,
              twiml: this.buildSpellNameTwiml(),
            });
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "name",
            sourceEventId: currentEventId,
            twiml: this.buildAskNameTwiml(),
          });
        }
        if (resolution.outcome === "REPLACE_CANDIDATE" && resolution.candidate) {
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
            return this.replyWithTwiml(
              res,
              this.buildTwiml(
                "Thanks. We'll follow up by text to confirm your details.",
              ),
            );
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "confirmation",
            targetField: "name",
            sourceEventId: currentEventId,
            twiml: this.buildNameConfirmationTwiml(resolution.candidate),
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "confirmation",
          targetField: "name",
          sourceEventId: currentEventId,
          twiml: this.buildYesNoRepromptTwiml(),
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
          return this.replyWithTwiml(
            res,
            this.buildTwiml(
              "Thanks. We'll follow up by text to confirm your details.",
            ),
          );
        }
        if (nextAttempt >= 2) {
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "name",
            sourceEventId: currentEventId,
            twiml: this.buildSpellNameTwiml(),
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "name",
          sourceEventId: currentEventId,
          twiml: this.buildAskNameTwiml(),
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
        twiml: this.buildNameConfirmationTwiml(validatedCandidate),
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
        return this.replyWithTwiml(
          res,
          this.buildTwiml(
            "Thanks. We'll follow up by text to confirm your address.",
          ),
        );
      }
      const duplicateMissing =
        !addressState.candidate && addressState.sourceEventId === currentEventId;
      if (duplicateMissing) {
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "address",
          sourceEventId: currentEventId,
          twiml: this.buildAskAddressTwiml(),
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
            twiml: this.buildIncompleteAddressTwiml(addressState.candidate),
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "confirmation",
          targetField: "address",
          sourceEventId: currentEventId,
          twiml: this.buildAddressConfirmationTwiml(addressState.candidate),
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
              twiml: this.buildIncompleteAddressTwiml(addressState.candidate),
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
              VoiceController.name,
            );
          }
          await this.clearVoiceListeningWindow({
            tenantId: tenant.id,
            conversationId,
          });
          return this.replyWithTwiml(
            res,
            this.buildSayGatherTwiml(
              "Thanks. Please describe the issue you're having.",
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
              VoiceController.name,
            );
            await this.clearVoiceListeningWindow({
              tenantId: tenant.id,
              conversationId,
            });
            return this.replyWithTwiml(
              res,
              this.buildTwiml(
                "Thanks. We'll follow up by text to confirm your address.",
              ),
            );
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "address",
            sourceEventId: currentEventId,
            twiml: this.buildAskAddressTwiml(),
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
            return this.replyWithTwiml(
              res,
              this.buildTwiml(
                "Thanks. We'll follow up by text to confirm your address.",
              ),
            );
          }
          return this.replyWithListeningWindow({
            res,
            tenantId: tenant.id,
            conversationId,
            field: "confirmation",
            targetField: "address",
            sourceEventId: currentEventId,
            twiml: this.buildAddressConfirmationTwiml(resolution.candidate),
          });
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "confirmation",
          targetField: "address",
          sourceEventId: currentEventId,
          twiml: this.buildYesNoRepromptTwiml(),
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
            VoiceController.name,
          );
          await this.clearVoiceListeningWindow({
            tenantId: tenant.id,
            conversationId,
          });
          return this.replyWithTwiml(
            res,
            this.buildTwiml(
              "Thanks. We'll follow up by text to confirm your address.",
            ),
          );
        }
        return this.replyWithListeningWindow({
          res,
          tenantId: tenant.id,
          conversationId,
          field: "address",
          sourceEventId: currentEventId,
          twiml: this.buildIncompleteAddressTwiml(candidateAddress),
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
      return this.replyWithListeningWindow({
        res,
        tenantId: tenant.id,
        conversationId,
        field: "confirmation",
        targetField: "address",
        sourceEventId: currentEventId,
        twiml: this.buildAddressConfirmationTwiml(candidateAddress),
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
      return this.replyWithTwiml(
        res,
        this.buildSayGatherTwiml(
          "Thanks. Please describe the issue you're having.",
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
        return this.replyWithTwiml(res, this.buildTwiml(message));
      }
      return this.replyWithTwiml(res, this.unroutableTwiml());
    } catch {
      this.loggingService.warn(
        {
          event: "ai.preview_fallback",
          tenantId: tenant.id,
          callSid,
          conversationId,
          reason: "voice_triage_failed",
        },
        VoiceController.name,
      );
      return this.replyWithTwiml(
        res,
        this.buildTwiml(
          "We're having trouble handling your call. Please try again later.",
        ),
      );
    }
  }

  @Post("fallback")
  handleFallback(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.replyWithTwiml(res, this.disabledTwiml());
    }
    return this.replyWithTwiml(
      res,
      this.buildTwiml(
        "We're having trouble handling your call. Please try again later.",
      ),
    );
  }

  @Post("status")
  handleStatus(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    return res.status(200).send();
  }

  private shouldVerifySignature(): boolean {
    return (
      this.config.environment === "production" &&
      this.config.twilioSignatureCheck
    );
  }

  private verifySignature(req: Request) {
    if (!this.shouldVerifySignature()) {
      return;
    }

    const signature = req.header("x-twilio-signature");
    if (!signature) {
      throw new UnauthorizedException("Missing Twilio signature.");
    }

    const baseUrl = this.config.twilioWebhookBaseUrl;
    if (!baseUrl) {
      throw new UnauthorizedException("Webhook base URL not configured.");
    }

    const url = `${baseUrl.replace(/\/$/, "")}${req.originalUrl}`;
    const params = (req.body ?? {}) as Record<string, unknown>;
    const isValid = validateRequest(
      this.config.twilioAuthToken,
      signature,
      url,
      params,
    );

    if (!isValid) {
      throw new UnauthorizedException("Invalid Twilio signature.");
    }
  }

  private replyWithTwiml(res: Response, twiml: string) {
    return res.status(200).type("text/xml").send(twiml);
  }

  private disabledTwiml(): string {
    return this.buildTwiml(
      "Voice intake is currently unavailable. Please try again later.",
    );
  }

  private unroutableTwiml(): string {
    return this.buildTwiml(
      "We're unable to route your call at this time.",
    );
  }

  private buildConsentTwiml(): string {
    const actionUrl = this.buildWebhookUrl("/api/voice/turn");
    const consent =
      "This call may be transcribed and handled by automated systems for service and quality purposes. By continuing, you consent to this process.";
    const greeting = "Thanks for calling. Please say your full name.";
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      consent,
    )}</Say><Say>${this.escapeXml(
      greeting,
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

  private buildRepromptTwiml(): string {
    const actionUrl = this.buildWebhookUrl("/api/voice/turn");
    const message = "Sorry, I didn't catch that. Please say that again.";
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Gather input="speech" action="${this.escapeXml(
      actionUrl,
    )}" method="POST" timeout="5" speechTimeout="auto"/></Response>`;
  }

  private buildNameConfirmationTwiml(candidate: string): string {
    const message = `I heard ${candidate}. If that's right, say 'yes'. Otherwise, say your full name again.`;
    return this.buildSayGatherTwiml(message, { bargeIn: true });
  }

  private buildNameSoftConfirmationTwiml(candidate: string): string {
    const message = `Great, I've got ${candidate}. If that's right, say 'yes'. Otherwise, say your full name again.`;
    return this.buildSayGatherTwiml(message, { bargeIn: true });
  }

  private buildAskNameTwiml(): string {
    return this.buildSayGatherTwiml("Sorry about that. Please say your full name.");
  }

  private buildSpellNameTwiml(): string {
    return this.buildSayGatherTwiml(
      "I'm having trouble with the name. Please spell your first name, then say your last name.",
    );
  }

  private buildAddressConfirmationTwiml(candidate: string): string {
    const message = `I heard ${candidate}. If that's right, say 'yes'. Otherwise, say the full address again.`;
    return this.buildSayGatherTwiml(message, { timeout: 8, bargeIn: true });
  }

  private buildAddressSoftConfirmationTwiml(candidate: string): string {
    const message = `Great, I've got ${candidate}. If that's right, say 'yes'. Otherwise, say the full address again.`;
    return this.buildSayGatherTwiml(message, { timeout: 8, bargeIn: true });
  }

  private buildAskAddressTwiml(): string {
    return this.buildSayGatherTwiml(
      "Sorry about that. Please say your full service address.",
      { timeout: 8 },
    );
  }

  private buildIncompleteAddressTwiml(candidate: string): string {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    const tokens = normalized ? normalized.split(" ") : [];
    const numberIndex = tokens.findIndex((token) => /\d/.test(token));
    if (numberIndex === -1) {
      return this.buildSayGatherTwiml(
        "I didn't catch the house number. Please repeat the full street name and city.",
      );
    }
    const numberToken = tokens[numberIndex];
    const prefixTokens = tokens.slice(numberIndex + 1, numberIndex + 4);
    const prefix = prefixTokens.length ? ` ${prefixTokens.join(" ")}` : "";
    const message = `I heard: ${numberToken}${prefix}... That seems incomplete. Please repeat the full street name and city.`;
    return this.buildSayGatherTwiml(message, { timeout: 8 });
  }

  private buildYesNoRepromptTwiml(): string {
    return this.buildSayGatherTwiml(
      "Please say 'yes' or say the correct details.",
      { bargeIn: true },
    );
  }

  private buildWebhookUrl(path: string): string {
    const baseUrl = this.config.twilioWebhookBaseUrl?.replace(/\/$/, "");
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
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

  private isVoiceFieldReady(locked: boolean, confirmed: string | null): boolean {
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
    return typeof data.voiceLastEventId === "string" ? data.voiceLastEventId : null;
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
  }): string {
    const expectedField = this.getExpectedListeningField(params.window);
    if (expectedField === "name") {
      if (params.nameState.candidate.value) {
        return this.buildNameConfirmationTwiml(params.nameState.candidate.value);
      }
      if (params.nameState.attemptCount >= 2) {
        return this.buildSpellNameTwiml();
      }
      return this.buildAskNameTwiml();
    }
    if (expectedField === "address") {
      if (params.addressState.candidate) {
        if (this.isIncompleteAddress(params.addressState.candidate)) {
          return this.buildIncompleteAddressTwiml(params.addressState.candidate);
        }
        return this.buildAddressConfirmationTwiml(params.addressState.candidate);
      }
      return this.buildAskAddressTwiml();
    }
    return this.buildRepromptTwiml();
  }

  private async replyWithListeningWindow(params: {
    res: Response;
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
        const remainder = cleaned.slice(prefix.length).replace(/^[\s,!.?]+/, "");
        return remainder.replace(
          /^(?:it's|it is|its|that is|that's)\s+/i,
          "",
        );
      }
    }
    return cleaned;
  }

  private async buildSideQuestionReply(
    tenantId: string,
    transcript: string,
  ): Promise<string | null> {
    const normalized = this.sanitizationService
      .normalizeWhitespace(transcript)
      .toLowerCase();
    if (!this.isLikelyQuestion(normalized)) {
      return null;
    }

    if (/(fee|cost|price|charge|diagnostic)/.test(normalized)) {
      return "We do have a $99 diagnostic fee, and it's credited toward repairs if you approve work within 24 hours.";
    }

    if (/(when|availability|available|can you come|how soon)/.test(normalized)) {
      return "We can check availability once I have your address.";
    }

    if (/(who (are|am) i speaking with|who is this|what's your name)/.test(normalized)) {
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
    const lastTranscript = typeof data.lastTranscript === "string"
      ? data.lastTranscript
      : null;
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
      .replace(/[^a-z\s'-.]/g, " ");
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
    const tokenPattern = "([A-Za-z][A-Za-z'\\-]*(?:\\s+[A-Za-z][A-Za-z'\\-]*){0,2})";
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
    let letters: string[] = [];
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

  private extractToNumber(req: Request): string | null {
    const value = req.body?.To ?? req.body?.to;
    return typeof value === "string" ? value : null;
  }

  private getRequestId(req: Request): string | undefined {
    return typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : undefined;
  }

  private extractCallSid(req: Request): string | null {
    const value = req.body?.CallSid ?? req.body?.callSid;
    return typeof value === "string" ? value : null;
  }

  private extractSpeechResult(req: Request): string | null {
    const value = req.body?.SpeechResult ?? req.body?.speechResult;
    return typeof value === "string" ? value : null;
  }

  private extractConfidence(req: Request): string | null {
    const value = req.body?.Confidence ?? req.body?.confidence;
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : null;
  }

  private normalizeConfidence(value: string | null): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseFloat(value);
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

  private extractFromNumber(req: Request): string | null {
    const value = req.body?.From ?? req.body?.from;
    return typeof value === "string" ? value : null;
  }

  private buildTwiml(message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Hangup/></Response>`;
  }
}
