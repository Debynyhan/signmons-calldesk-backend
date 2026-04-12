import {
  Controller,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import appConfig, { type AppConfig } from "../config/app.config";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { ConversationLifecycleService } from "../conversations/conversation-lifecycle.service";
import { setRequestContextData } from "../common/context/request-context";
import { LoggingService } from "../logging/logging.service";
import {
  buildStreamUrl,
  buildStreamingTwiml,
  VOICE_STREAM_PATH,
} from "./voice-streaming.utils";
import { VoiceWebhookParserService } from "./voice-webhook-parser.service";
import { VoiceTurnService } from "./voice-turn.service";
import { VoiceConsentAudioService } from "./voice-consent-audio.service";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";
import { VoiceTurnPolicyService } from "./voice-turn-policy.service";
import { VoiceResponseService } from "./voice-response.service";
import { TwilioSignatureGuard } from "./twilio-signature.guard";

@UseGuards(TwilioSignatureGuard)
@Controller("api/voice")
export class VoiceController {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    private readonly conversationLifecycleService: ConversationLifecycleService,
    private readonly voiceWebhookParser: VoiceWebhookParserService,
    private readonly voiceTurnService: VoiceTurnService,
    private readonly voiceConsentAudioService: VoiceConsentAudioService,
    private readonly voicePromptComposer: VoicePromptComposerService,
    private readonly voiceTurnPolicy: VoiceTurnPolicyService,
    private readonly voiceResponse: VoiceResponseService,
    private readonly loggingService: LoggingService,
  ) {}

  @Post("inbound")
  async handleInbound(@Req() req: Request, @Res() res: Response) {
    if (!this.config.voiceEnabled) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voicePromptComposer.disabledTwiml(),
      });
    }
    const toNumber = this.voiceWebhookParser.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "tenant_not_found",
      });
    }
    const displayName = this.voiceTurnPolicy.getTenantDisplayName(tenant);
    const callSid = this.voiceWebhookParser.extractCallSid(req);
    if (!callSid) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "missing_call_sid",
      });
    }
    const requestId = this.voiceWebhookParser.getRequestId(req);
    const callerPhone =
      this.voiceWebhookParser.extractFromNumber(req) ?? undefined;
    const conversation =
      await this.conversationLifecycleService.ensureVoiceConsentConversation({
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
      this.useGoogleStreamingStt() &&
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
        this.voicePromptComposer.buildConsentMessage(displayName);
      const streamUrl = buildStreamUrl(
        this.config.twilioWebhookBaseUrl,
        VOICE_STREAM_PATH,
      );
      let playUrl = await this.voiceConsentAudioService.getCachedConsentUrl(
        tenant.id,
        consentMessage,
      );
      if (!playUrl) {
        // Synthesize inline on first call so the greeting uses the same Google
        // TTS voice as all subsequent streaming turns (no mid-call voice switch).
        playUrl = await this.voiceConsentAudioService.synthesizeAndGetUrl(
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
      return this.voiceResponse.replyWithTwiml(res, twiml);
    }

    return this.voiceResponse.replyWithTwiml(
      res,
      this.voicePromptComposer.buildConsentTwiml(displayName),
    );
  }

  @Post("demo-inbound")
  async handleDemoInbound(@Req() req: Request, @Res() res: Response) {
    if (!this.config.voiceEnabled) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voicePromptComposer.disabledTwiml(),
      });
    }

    const demoTenantId = this.config.demoTenantId;
    if (!demoTenantId) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "demo_tenant_not_configured",
      });
    }

    const tenant = await this.tenantsService.getTenantById(demoTenantId);
    if (!tenant) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "demo_tenant_not_found",
      });
    }

    const callSid = this.voiceWebhookParser.extractCallSid(req);
    if (!callSid) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "missing_call_sid",
      });
    }

    const requestId =
      typeof req.query.leadId === "string" ? req.query.leadId : undefined;
    const callerPhone =
      this.voiceWebhookParser.extractToNumber(req) ?? undefined;
    const conversation =
      await this.conversationLifecycleService.ensureVoiceConsentConversation({
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

    const displayName = this.voiceTurnPolicy.getTenantDisplayName(tenant);
    if (
      this.config.voiceStreamingEnabled &&
      this.useGoogleStreamingStt() &&
      this.config.twilioWebhookBaseUrl
    ) {
      const consentMessage =
        this.voicePromptComposer.buildConsentMessage(displayName);
      const streamUrl = buildStreamUrl(
        this.config.twilioWebhookBaseUrl,
        VOICE_STREAM_PATH,
      );
      let playUrl = await this.voiceConsentAudioService.getCachedConsentUrl(
        tenant.id,
        consentMessage,
      );
      if (!playUrl) {
        playUrl = await this.voiceConsentAudioService.synthesizeAndGetUrl(
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
      return this.voiceResponse.replyWithTwiml(res, twiml);
    }

    return this.voiceResponse.replyWithTwiml(
      res,
      this.voicePromptComposer.buildConsentTwiml(displayName),
    );
  }

  @Post("turn")
  async handleTurn(@Req() req: Request, @Res() res: Response) {
    if (!this.config.voiceEnabled) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voicePromptComposer.disabledTwiml(),
      });
    }
    const toNumber = this.voiceWebhookParser.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "tenant_not_found",
      });
    }
    const callSid = this.voiceWebhookParser.extractCallSid(req);
    if (!callSid) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "missing_call_sid",
      });
    }
    const speechResult = this.voiceWebhookParser.extractSpeechResult(req);
    const confidence = this.voiceWebhookParser.extractConfidence(req);
    const requestId = this.voiceWebhookParser.getRequestId(req);
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
    if (!this.config.voiceEnabled) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voicePromptComposer.disabledTwiml(),
      });
    }
    const toNumber = this.voiceWebhookParser.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    const displayName = tenant
      ? this.voiceTurnPolicy.getTenantDisplayName(tenant)
      : undefined;
    const callSid = this.voiceWebhookParser.extractCallSid(req) ?? undefined;
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
    return this.voiceResponse.replyWithHumanFallback({
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
    return res.status(200).send();
  }

  private useGoogleStreamingStt(): boolean {
    return (
      this.config.voiceSttProvider === "google" &&
      this.config.googleSpeechEnabled
    );
  }

}
