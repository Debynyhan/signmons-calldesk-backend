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
import { AddressValidationService } from "../address/address-validation.service";

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
    private readonly addressValidationService: AddressValidationService,
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

    const nameState = this.conversationsService.getVoiceNameState(
      updatedConversation?.collectedData ?? conversation.collectedData,
    );
    const currentEventId = transcriptEventId;
    if (nameState.status !== "CONFIRMED") {
      const duplicateMissing =
        !nameState.candidate.value &&
        nameState.candidate.sourceEventId === currentEventId;
      if (duplicateMissing) {
        return this.replyWithTwiml(res, this.buildAskNameTwiml());
      }
      const candidateForEvent =
        Boolean(nameState.candidate.value) &&
        nameState.candidate.sourceEventId === currentEventId;
      if (candidateForEvent && nameState.candidate.value) {
        return this.replyWithTwiml(
          res,
          this.buildNameConfirmationTwiml(nameState.candidate.value),
        );
      }
      if (nameState.candidate.value) {
        const confirmation = this.parseConfirmation(normalizedSpeech);
        if (confirmation === "confirm") {
          if (!nameState.locked) {
            const confirmedAt = new Date().toISOString();
            const nextNameState: typeof nameState = {
              ...nameState,
              confirmed: {
                value: nameState.candidate.value,
                sourceEventId: currentEventId,
                confirmedAt,
              },
              status: "CONFIRMED",
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
          return this.replyWithTwiml(
            res,
            this.buildSayGatherTwiml("Thanks. Please say your full address."),
          );
        }
        if (confirmation === "reject") {
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
            return this.replyWithTwiml(
              res,
              this.buildTwiml(
                "Thanks. We'll follow up by text to confirm your details.",
              ),
            );
          }
          return this.replyWithTwiml(res, this.buildAskNameTwiml());
        }
        return this.replyWithTwiml(res, this.buildYesNoRepromptTwiml());
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
      if (!candidateName) {
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
          return this.replyWithTwiml(
            res,
            this.buildTwiml(
              "Thanks. We'll follow up by text to confirm your details.",
            ),
          );
        }
        return this.replyWithTwiml(res, this.buildAskNameTwiml());
      }

      const nextNameState: typeof nameState = {
        ...nameState,
        candidate: {
          value: candidateName,
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
      return this.replyWithTwiml(
        res,
        this.buildNameConfirmationTwiml(candidateName),
      );
    }

    if (
      nameState.locked &&
      nameState.confirmed.sourceEventId &&
      nameState.confirmed.sourceEventId === currentEventId
    ) {
      return this.replyWithTwiml(
        res,
        this.buildSayGatherTwiml("Thanks. Please say your full address."),
      );
    }

    const addressState = this.conversationsService.getVoiceAddressState(
      updatedConversation?.collectedData ?? conversation.collectedData,
    );
    if (addressState.status !== "CONFIRMED") {
      if (addressState.status === "FAILED") {
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
        return this.replyWithTwiml(res, this.buildAskAddressTwiml());
      }

      const candidateForEvent =
        Boolean(addressState.candidate) &&
        addressState.sourceEventId === currentEventId;
      if (candidateForEvent && addressState.candidate) {
        if (this.isIncompleteAddress(addressState.candidate)) {
          return this.replyWithTwiml(
            res,
            this.buildIncompleteAddressTwiml(addressState.candidate),
          );
        }
        return this.replyWithTwiml(
          res,
          this.buildAddressConfirmationTwiml(addressState.candidate),
        );
      }

      if (addressState.candidate) {
        const confirmation = this.parseConfirmation(normalizedSpeech);
        if (confirmation === "confirm") {
          if (!addressState.locked) {
            const confirmedAt = new Date().toISOString();
            let confirmedAddress = addressState.candidate;
            try {
              confirmedAddress =
                await this.addressValidationService.validateConfirmedAddress({
                  tenantId: tenant.id,
                  conversationId,
                  address: addressState.candidate,
                  callSid,
                  sourceEventId: currentEventId,
                });
            } catch (error) {
              this.loggingService.warn(
                {
                  event: "address.validation_failed",
                  tenantId: tenant.id,
                  conversationId,
                  callSid,
                  sourceEventId: currentEventId,
                  error:
                    error instanceof Error ? error.message : "unknown_error",
                },
                VoiceController.name,
              );
            }
            const nextAddressState: typeof addressState = {
              ...addressState,
              confirmed: confirmedAddress,
              status: "CONFIRMED",
              locked: true,
              sourceEventId: currentEventId,
            };
            await this.conversationsService.updateVoiceAddressState({
              tenantId: tenant.id,
              conversationId,
              addressState: nextAddressState,
              confirmation: {
                field: "address",
                value: confirmedAddress,
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
          return this.replyWithTwiml(
            res,
            this.buildSayGatherTwiml(
              "Thanks. Please describe the issue you're having.",
            ),
          );
        }
        if (confirmation === "reject") {
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
            return this.replyWithTwiml(
              res,
              this.buildTwiml(
                "Thanks. We'll follow up by text to confirm your address.",
              ),
            );
          }
          return this.replyWithTwiml(res, this.buildAskAddressTwiml());
        }
        return this.replyWithTwiml(res, this.buildYesNoRepromptTwiml());
      }

      const extracted = await this.aiService.extractAddressCandidate(
        tenant.id,
        normalizedSpeech,
      );
      const candidateAddress = this.normalizeAddressCandidate(
        extracted?.address ?? "",
      );
      const minConfidence = this.config.voiceAddressMinConfidence ?? 0.7;
      const confidence =
        typeof extracted?.confidence === "number"
          ? extracted.confidence
          : undefined;
      const meetsConfidence =
        typeof confidence === "number" && confidence >= minConfidence;
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
          confidence,
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
              confidence,
            },
            VoiceController.name,
          );
          return this.replyWithTwiml(
            res,
            this.buildTwiml(
              "Thanks. We'll follow up by text to confirm your address.",
            ),
          );
        }
        return this.replyWithTwiml(
          res,
          this.buildIncompleteAddressTwiml(candidateAddress),
        );
      }

      const nextAddressState: typeof addressState = {
        ...addressState,
        candidate: candidateAddress,
        status: "CANDIDATE",
        confidence,
        sourceEventId: currentEventId,
      };
      await this.conversationsService.updateVoiceAddressState({
        tenantId: tenant.id,
        conversationId,
        addressState: nextAddressState,
      });
      return this.replyWithTwiml(
        res,
        this.buildAddressConfirmationTwiml(candidateAddress),
      );
    }

    if (
      addressState.locked &&
      addressState.sourceEventId &&
      addressState.sourceEventId === currentEventId
    ) {
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
        const safeReply = this.capAiReply(aiResult.reply);
        if (this.shouldGatherMore(safeReply)) {
          return this.replyWithTwiml(res, this.buildSayGatherTwiml(safeReply));
        }
        return this.replyWithTwiml(res, this.buildTwiml(safeReply));
      }
      if (aiResult.status === "job_created" && "message" in aiResult) {
        const message = this.capAiReply(
          aiResult.message ?? "Your request has been booked.",
        );
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

  private buildSayGatherTwiml(message: string): string {
    const actionUrl = this.buildWebhookUrl("/api/voice/turn");
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Gather input="speech" action="${this.escapeXml(
      actionUrl,
    )}" method="POST" timeout="5" speechTimeout="auto"/></Response>`;
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
    const message = `I heard ${candidate}. Is that correct? Please say 'yes' or 'no'.`;
    return this.buildSayGatherTwiml(message);
  }

  private buildAskNameTwiml(): string {
    return this.buildSayGatherTwiml("Sorry about that. Please say your full name.");
  }

  private buildAddressConfirmationTwiml(candidate: string): string {
    const message = `I heard ${candidate}. Is that correct? Please say 'yes' or 'no'.`;
    return this.buildSayGatherTwiml(message);
  }

  private buildAskAddressTwiml(): string {
    return this.buildSayGatherTwiml(
      "Sorry about that. Please say your full service address.",
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
    return this.buildSayGatherTwiml(message);
  }

  private buildYesNoRepromptTwiml(): string {
    return this.buildSayGatherTwiml("Please say 'yes' or 'no'.");
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

  private parseConfirmation(
    transcript: string,
  ): "confirm" | "reject" | "unknown" {
    const normalized = this.sanitizationService
      .normalizeWhitespace(transcript)
      .toLowerCase()
      .replace(/[^\w\s']/g, "");
    const confirm = new Set([
      "yes",
      "yeah",
      "correct",
      "thats right",
      "that's right",
      "right",
      "affirmative",
    ]);
    const reject = new Set([
      "no",
      "nope",
      "incorrect",
      "not right",
      "negative",
    ]);
    if (confirm.has(normalized)) {
      return "confirm";
    }
    if (reject.has(normalized)) {
      return "reject";
    }
    return "unknown";
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
    return null;
  }

  private isValidNameCandidate(candidate: string): boolean {
    const tokens = candidate.split(" ").filter(Boolean);
    if (tokens.length < 2 || tokens.length > 3) {
      return false;
    }
    return tokens.every((token) => /^[A-Za-z][A-Za-z'-]*$/.test(token));
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
