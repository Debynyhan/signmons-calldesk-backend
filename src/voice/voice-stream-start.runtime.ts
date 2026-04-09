import type { AppConfig } from "../config/app.config";
import { ConversationsService } from "../conversations/conversations.service";
import { GoogleSpeechService } from "../google/google-speech.service";
import { LoggingService } from "../logging/logging.service";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { buildStreamUrl, VOICE_STREAM_PATH } from "./voice-streaming.utils";
import type { VoiceStreamSession } from "./voice-stream.types";

type PrepareStartSessionParams = {
  callSid: string;
  streamSid: string;
  customParameters?: Record<string, string>;
};

export class VoiceStreamStartRuntime {
  private static readonly LOG_SOURCE = "VoiceStreamGateway";

  constructor(
    private readonly config: AppConfig,
    private readonly tenantsService: TenantsService,
    private readonly conversationsService: ConversationsService,
    private readonly googleSpeechService: GoogleSpeechService,
    private readonly loggingService: LoggingService,
  ) {}

  async prepareStartSession(
    params: PrepareStartSessionParams,
  ): Promise<VoiceStreamSession | null> {
    if (this.config.voiceSttProvider !== "google") {
      this.loggingService.warn(
        { event: "voice.stream.stt_provider_disabled" },
        VoiceStreamStartRuntime.LOG_SOURCE,
      );
      return null;
    }
    if (!this.googleSpeechService.isEnabled()) {
      this.loggingService.warn(
        { event: "voice.stream.speech_disabled" },
        VoiceStreamStartRuntime.LOG_SOURCE,
      );
      return null;
    }
    if (!this.config.twilioWebhookBaseUrl) {
      this.loggingService.warn(
        { event: "voice.stream.missing_base_url" },
        VoiceStreamStartRuntime.LOG_SOURCE,
      );
      return null;
    }

    const tenantId = params.customParameters?.tenantId ?? this.config.demoTenantId;
    if (!tenantId) {
      this.loggingService.warn(
        { event: "voice.stream.missing_tenant", callSid: params.callSid },
        VoiceStreamStartRuntime.LOG_SOURCE,
      );
      return null;
    }

    const tenant = await this.tenantsService.getTenantById(tenantId);
    if (!tenant) {
      this.loggingService.warn(
        {
          event: "voice.stream.tenant_not_found",
          callSid: params.callSid,
          tenantId,
        },
        VoiceStreamStartRuntime.LOG_SOURCE,
      );
      return null;
    }

    const leadId = params.customParameters?.leadId;
    await this.conversationsService.ensureVoiceConsentConversation({
      tenantId: tenant.id,
      callSid: params.callSid,
      requestId: leadId,
    });

    const speechStream = this.googleSpeechService.createStreamingRecognizeStream();
    if (!speechStream) {
      return null;
    }

    const streamUrl = buildStreamUrl(
      this.config.twilioWebhookBaseUrl,
      VOICE_STREAM_PATH,
    );

    return {
      callSid: params.callSid,
      streamSid: params.streamSid,
      tenantId: tenant.id,
      tenant,
      leadId,
      streamUrl,
      speechStream,
      processing: false,
      startedAtMs: Date.now(),
      speechRestartCount: 0,
      closed: false,
    };
  }
}
