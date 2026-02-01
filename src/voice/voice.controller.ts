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
import appConfig, { type AppConfig } from "../config/app.config";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { ConversationsService } from "../conversations/conversations.service";
import { setRequestContextData } from "../common/context/request-context";
import { LoggingService } from "../logging/logging.service";
import {
  buildStreamUrl,
  buildStreamingTwiml,
  VOICE_STREAM_PATH,
} from "./voice-streaming.utils";
import { VoiceTurnService } from "./voice-turn.service";
import { VoiceConsentAudioService } from "./voice-consent-audio.service";

@Controller("api/voice")
export class VoiceController {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    private readonly conversationsService: ConversationsService,
    private readonly voiceTurnService: VoiceTurnService,
    private readonly voiceConsentAudioService: VoiceConsentAudioService,
    private readonly loggingService: LoggingService,
  ) {}

  @Post("inbound")
  async handleInbound(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voiceTurnService.disabledTwiml(),
      });
    }
    const toNumber = this.voiceTurnService.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        reason: "tenant_not_found",
      });
    }
    const displayName = this.voiceTurnService.getTenantDisplayName(tenant);
    const callSid = this.voiceTurnService.extractCallSid(req);
    if (!callSid) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "missing_call_sid",
      });
    }
    const requestId = this.voiceTurnService.getRequestId(req);
    const callerPhone =
      this.voiceTurnService.extractFromNumber(req) ?? undefined;
    const conversation =
      await this.conversationsService.ensureVoiceConsentConversation({
        tenantId: tenant.id,
        callSid,
        requestId,
        callerPhone,
      });
    setRequestContextData({
      tenantId: tenant.id,
      conversationId: conversation.id,
      callSid,
      channel: "VOICE",
      sourceEventId: `${callSid}:inbound`,
    });
    if (
      this.config.voiceStreamingEnabled &&
      this.config.googleSpeechEnabled &&
      this.config.twilioWebhookBaseUrl
    ) {
      this.loggingService.log(
        {
          event: "voice.streaming_inbound_selected",
          tenantId: tenant.id,
          callSid,
        },
        VoiceController.name,
      );
      const consentMessage =
        this.voiceTurnService.buildConsentMessage(displayName);
      const streamUrl = buildStreamUrl(
        this.config.twilioWebhookBaseUrl,
        VOICE_STREAM_PATH,
      );
      const playUrl = await this.voiceConsentAudioService.getCachedConsentUrl(
        tenant.id,
        consentMessage,
      );
      if (!playUrl) {
        this.voiceConsentAudioService.warmConsentAudio(
          tenant.id,
          consentMessage,
        );
      }
      const twiml = buildStreamingTwiml({
        streamUrl,
        streamParams: {
          tenantId: tenant.id,
        },
        playUrl: playUrl ?? undefined,
        sayText: playUrl ? undefined : consentMessage,
        keepAliveSec: this.config.voiceStreamingKeepAliveSec,
        track: this.config.voiceStreamingTrack,
      });
      return this.voiceTurnService.replyWithTwiml(res, twiml);
    }

    return this.voiceTurnService.replyWithTwiml(
      res,
      this.voiceTurnService.buildConsentTwiml(displayName),
    );
  }

  @Post("demo-inbound")
  async handleDemoInbound(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voiceTurnService.disabledTwiml(),
      });
    }

    const demoTenantId = this.config.demoTenantId;
    if (!demoTenantId) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        reason: "demo_tenant_not_configured",
      });
    }

    const tenant = await this.tenantsService.getTenantById(demoTenantId);
    if (!tenant) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        reason: "demo_tenant_not_found",
      });
    }

    const callSid = this.voiceTurnService.extractCallSid(req);
    if (!callSid) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "missing_call_sid",
      });
    }

    const requestId =
      typeof req.query.leadId === "string" ? req.query.leadId : undefined;
    const callerPhone = this.voiceTurnService.extractToNumber(req) ?? undefined;
    const conversation =
      await this.conversationsService.ensureVoiceConsentConversation({
        tenantId: tenant.id,
        callSid,
        requestId,
        callerPhone,
      });

    setRequestContextData({
      tenantId: tenant.id,
      conversationId: conversation.id,
      callSid,
      channel: "VOICE",
      sourceEventId: `${callSid}:demo-inbound`,
    });

    const displayName = this.voiceTurnService.getTenantDisplayName(tenant);
    if (
      this.config.voiceStreamingEnabled &&
      this.config.googleSpeechEnabled &&
      this.config.twilioWebhookBaseUrl
    ) {
      const consentMessage =
        this.voiceTurnService.buildConsentMessage(displayName);
      const streamUrl = buildStreamUrl(
        this.config.twilioWebhookBaseUrl,
        VOICE_STREAM_PATH,
      );
      const playUrl = await this.voiceConsentAudioService.getCachedConsentUrl(
        tenant.id,
        consentMessage,
      );
      if (!playUrl) {
        this.voiceConsentAudioService.warmConsentAudio(
          tenant.id,
          consentMessage,
        );
      }
      const twiml = buildStreamingTwiml({
        streamUrl,
        streamParams: {
          tenantId: tenant.id,
          leadId: requestId,
        },
        playUrl: playUrl ?? undefined,
        sayText: playUrl ? undefined : consentMessage,
        keepAliveSec: this.config.voiceStreamingKeepAliveSec,
        track: this.config.voiceStreamingTrack,
      });
      return this.voiceTurnService.replyWithTwiml(res, twiml);
    }

    return this.voiceTurnService.replyWithTwiml(
      res,
      this.voiceTurnService.buildConsentTwiml(displayName),
    );
  }

  @Post("turn")
  async handleTurn(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voiceTurnService.disabledTwiml(),
      });
    }
    const toNumber = this.voiceTurnService.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        reason: "tenant_not_found",
      });
    }
    const callSid = this.voiceTurnService.extractCallSid(req);
    if (!callSid) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "missing_call_sid",
      });
    }
    const speechResult = this.voiceTurnService.extractSpeechResult(req);
    const confidence = this.voiceTurnService.extractConfidence(req);
    const requestId = this.voiceTurnService.getRequestId(req);
    return this.voiceTurnService.handleTurn({
      res,
      tenant,
      callSid,
      speechResult,
      confidence,
      requestId,
    });
  }

  @Post("fallback")
  async handleFallback(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.voiceTurnService.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voiceTurnService.disabledTwiml(),
      });
    }
    const toNumber = this.voiceTurnService.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    const displayName = tenant
      ? this.voiceTurnService.getTenantDisplayName(tenant)
      : undefined;
    const callSid = this.voiceTurnService.extractCallSid(req) ?? undefined;
    const payload = (req.body ?? {}) as Record<string, unknown>;
    const errorCode =
      typeof payload.ErrorCode === "string" ? payload.ErrorCode : undefined;
    const errorMessage =
      typeof payload.ErrorMessage === "string"
        ? payload.ErrorMessage
        : undefined;
    const errorUrl =
      typeof payload.ErrorUrl === "string" ? payload.ErrorUrl : undefined;
    this.loggingService.warn(
      {
        event: "voice.twilio_fallback",
        tenantId: tenant?.id,
        callSid,
        errorCode,
        errorMessage,
        errorUrl,
      },
      VoiceController.name,
    );
    return this.voiceTurnService.replyWithHumanFallback({
      res,
      tenantId: tenant?.id,
      callSid,
      displayName,
      reason: "twilio_fallback",
      messageOverride:
        "We're having trouble handling your call. Please try again later.",
    });
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
}
