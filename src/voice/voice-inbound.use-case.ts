import { Injectable, Inject } from "@nestjs/common";
import type { Request, Response } from "express";
import appConfig, { type AppConfig } from "../config/app.config";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { CONVERSATION_LIFECYCLE_SERVICE, type IConversationLifecycleService } from "../conversations/conversation-lifecycle.service.interface";
import { setRequestContextData } from "../common/context/request-context";
import { LoggingService } from "../logging/logging.service";
import {
  buildStreamUrl,
  buildStreamingTwiml,
  VOICE_STREAM_PATH,
} from "./voice-streaming.utils";
import { VoiceWebhookParserService } from "./voice-webhook-parser.service";
import type { TwilioVoiceWebhookDto } from "./dto/twilio-voice-webhook.dto";
import { VoiceTurnService } from "./voice-turn.service";
import { VoiceConsentAudioService } from "./voice-consent-audio.service";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";
import { VoiceTurnPolicyService } from "./voice-turn-policy.service";
import { VoiceResponseService } from "./voice-response.service";

@Injectable()
export class VoiceInboundUseCase {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    @Inject(CONVERSATION_LIFECYCLE_SERVICE) private readonly conversationLifecycleService: IConversationLifecycleService,
    private readonly voiceWebhookParser: VoiceWebhookParserService,
    private readonly voiceTurnService: VoiceTurnService,
    private readonly voiceConsentAudioService: VoiceConsentAudioService,
    private readonly voicePromptComposer: VoicePromptComposerService,
    private readonly voiceTurnPolicy: VoiceTurnPolicyService,
    private readonly voiceResponse: VoiceResponseService,
    private readonly loggingService: LoggingService,
  ) {}

  async handleInbound(req: Request, res: Response) {
    if (!this.config.voiceEnabled) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voicePromptComposer.disabledTwiml(),
      });
    }
    const body = this.voiceBody(req);
    const toNumber = this.voiceWebhookParser.extractToNumber(body);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "tenant_not_found",
      });
    }
    const activeSubscription =
      await this.tenantsService.getActiveTenantSubscription(tenant.id);
    if (!activeSubscription) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "subscription_inactive",
        twimlOverride: this.voicePromptComposer.disabledTwiml(),
      });
    }
    const displayName = this.voiceTurnPolicy.getTenantDisplayName(tenant);
    const callSid = this.voiceWebhookParser.extractCallSid(body);
    if (!callSid) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "missing_call_sid",
      });
    }
    const requestId = this.voiceWebhookParser.getRequestId(req);
    const callerPhone =
      this.voiceWebhookParser.extractFromNumber(body) ?? undefined;
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
        VoiceInboundUseCase.name,
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

  async handleDemoInbound(req: Request, res: Response) {
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

    const activeSubscription =
      await this.tenantsService.getActiveTenantSubscription(tenant.id);
    if (!activeSubscription) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "subscription_inactive",
        twimlOverride: this.voicePromptComposer.disabledTwiml(),
      });
    }

    const demoBody = this.voiceBody(req);
    const callSid = this.voiceWebhookParser.extractCallSid(demoBody);
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
      this.voiceWebhookParser.extractToNumber(demoBody) ?? undefined;
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

  async handleTurn(req: Request, res: Response) {
    if (!this.config.voiceEnabled) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voicePromptComposer.disabledTwiml(),
      });
    }
    const turnBody = this.voiceBody(req);
    const toNumber = this.voiceWebhookParser.extractToNumber(turnBody);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "tenant_not_found",
      });
    }
    const callSid = this.voiceWebhookParser.extractCallSid(turnBody);
    if (!callSid) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        tenantId: tenant.id,
        reason: "missing_call_sid",
      });
    }
    const speechResult = this.voiceWebhookParser.extractSpeechResult(turnBody);
    const confidence = this.voiceWebhookParser.extractConfidence(turnBody);
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

  async handleFallback(req: Request, res: Response) {
    if (!this.config.voiceEnabled) {
      return this.voiceResponse.replyWithNoHandoff({
        res,
        reason: "voice_disabled",
        twimlOverride: this.voicePromptComposer.disabledTwiml(),
      });
    }
    const fallbackBody = this.voiceBody(req);
    const toNumber = this.voiceWebhookParser.extractToNumber(fallbackBody);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    const displayName = tenant
      ? this.voiceTurnPolicy.getTenantDisplayName(tenant)
      : undefined;
    const callSid = this.voiceWebhookParser.extractCallSid(fallbackBody) ?? undefined;
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
      VoiceInboundUseCase.name,
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

  private useGoogleStreamingStt(): boolean {
    return (
      this.config.voiceSttProvider === "google" &&
      this.config.googleSpeechEnabled
    );
  }

  private voiceBody(req: Request): TwilioVoiceWebhookDto {
    return (req.body ?? {}) as TwilioVoiceWebhookDto;
  }
}
