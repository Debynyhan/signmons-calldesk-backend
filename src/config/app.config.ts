import { registerAs } from "@nestjs/config";

export type NodeEnvironment = "development" | "production" | "test";

export interface AppConfig {
  environment: NodeEnvironment;
  openAiApiKey: string;
  enablePreviewModel: boolean;
  aiDefaultModel: string;
  aiPreviewModel: string;
  aiTextModel: string;
  aiVoiceModel: string;
  aiRouterModel: string;
  aiBookingModel: string;
  aiFaqModel: string;
  aiExtractionModel: string;
  aiRouterFlowEnabled: boolean;
  aiRouterFlowSmsEnabled: boolean;
  aiRouterFlowWebchatEnabled: boolean;
  aiRouterFlowAllowlistOnly: boolean;
  aiRouterFlowTenantAllowlist: string[];
  enabledTools: string[];
  aiMaxTokens: number;
  aiMaxToolCalls: number;
  aiTimeoutMs: number;
  aiMaxRetries: number;
  aiVoiceReplyTemperature: number;
  aiExtractionTemperature: number;
  port: number;
  databaseUrl: string;
  adminApiToken: string;
  devAuthEnabled: boolean;
  devAuthSecret: string;
  identityIssuer: string;
  identityAudience: string;
  firebaseProjectId?: string;
  googleCloudProject?: string;
  voiceEnabled: boolean;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  twilioSignatureCheck: boolean;
  twilioWebhookBaseUrl: string;
  demoTenantId: string;
  voiceMaxTurns: number;
  voiceMaxDurationSec: number;
  voiceAddressMinConfidence: number;
  voiceSoftConfirmMinConfidence: number;
  voiceStreamingEnabled: boolean;
  voiceStreamingKeepAliveSec: number;
  voiceStreamingTrack: "inbound" | "both";
  voiceSttProvider: "twilio" | "google";
  voiceTtsProvider: "twilio" | "google";
  addressValidationProvider: "none" | "google";
  googlePlacesApiKey: string;
  googleSpeechEnabled: boolean;
  googleSpeechLanguageCode: string;
  googleSpeechModel: string;
  googleSpeechUseEnhanced: boolean;
  googleSpeechEncoding: "MULAW" | "LINEAR16" | "OGG_OPUS";
  googleSpeechSampleRateHz: number;
  googleSpeechInterimResults: boolean;
  googleTtsEnabled: boolean;
  googleTtsLanguageCode: string;
  googleTtsVoiceName: string;
  googleTtsAudioEncoding: "MP3" | "OGG_OPUS" | "LINEAR16";
  googleTtsSpeakingRate: number;
  googleTtsPitch: number;
  googleTtsVolumeGainDb: number;
  googleTtsBucket: string;
  googleTtsSignedUrlTtlSec: number;
  corsOrigins: string[];
}

const DEFAULT_DATABASE_URL =
  "postgresql://signmons:Signmons-calldesk-backend-v1@localhost:5432/postgres?schema=calldesk";
const DEFAULT_CORS_ORIGINS = ["http://localhost:3000", "http://localhost:3101"];

export default registerAs("app", (): AppConfig => {
  const rawOrigins =
    process.env.FRONTEND_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  const corsOrigins = rawOrigins.length > 0 ? rawOrigins : DEFAULT_CORS_ORIGINS;
  const googleSpeechEnabled =
    (process.env.GOOGLE_SPEECH_ENABLED ?? "false").toLowerCase() === "true";
  const googleTtsEnabled =
    (process.env.GOOGLE_TTS_ENABLED ?? "false").toLowerCase() === "true";
  const voiceSttProviderRaw = (
    process.env.VOICE_STT_PROVIDER ?? ""
  ).toLowerCase();
  const voiceTtsProviderRaw = (
    process.env.VOICE_TTS_PROVIDER ?? ""
  ).toLowerCase();
  const voiceSttProvider: AppConfig["voiceSttProvider"] =
    voiceSttProviderRaw === "google"
      ? "google"
      : voiceSttProviderRaw === "twilio"
        ? "twilio"
        : googleSpeechEnabled
          ? "google"
          : "twilio";
  const voiceTtsProvider: AppConfig["voiceTtsProvider"] =
    voiceTtsProviderRaw === "google"
      ? "google"
      : voiceTtsProviderRaw === "twilio"
        ? "twilio"
        : googleTtsEnabled
          ? "google"
          : "twilio";

  return {
    environment: (process.env.NODE_ENV as NodeEnvironment) ?? "development",
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
    enablePreviewModel:
      (process.env.ENABLE_GPT5_1_CODEX ?? "false").toLowerCase() === "true",
    aiDefaultModel: process.env.AI_DEFAULT_MODEL ?? "gpt-4o-mini",
    aiPreviewModel: process.env.AI_PREVIEW_MODEL ?? "gpt-5.1-codex",
    aiTextModel: process.env.AI_TEXT_MODEL ?? "",
    aiVoiceModel: process.env.AI_VOICE_MODEL ?? "",
    aiRouterModel: process.env.AI_ROUTER_MODEL ?? "",
    aiBookingModel: process.env.AI_BOOKING_MODEL ?? "",
    aiFaqModel: process.env.AI_FAQ_MODEL ?? "",
    aiExtractionModel: process.env.AI_EXTRACTION_MODEL ?? "",
    aiRouterFlowEnabled:
      (process.env.AI_ROUTER_FLOW_ENABLED ?? "true").toLowerCase() === "true",
    aiRouterFlowSmsEnabled:
      (process.env.AI_ROUTER_FLOW_SMS_ENABLED ?? "true").toLowerCase() ===
      "true",
    aiRouterFlowWebchatEnabled:
      (process.env.AI_ROUTER_FLOW_WEBCHAT_ENABLED ?? "true").toLowerCase() ===
      "true",
    aiRouterFlowAllowlistOnly:
      (process.env.AI_ROUTER_FLOW_ALLOWLIST_ONLY ?? "false").toLowerCase() ===
      "true",
    aiRouterFlowTenantAllowlist:
      process.env.AI_ROUTER_FLOW_TENANT_ALLOWLIST?.split(",")
        .map((tenantId) => tenantId.trim())
        .filter(Boolean) ?? [],
    enabledTools: (process.env.ENABLED_TOOLS ??
      "route_conversation,create_job")
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean),
    aiMaxTokens: Number(process.env.AI_MAX_TOKENS ?? 800),
    aiMaxToolCalls: Number(process.env.AI_MAX_TOOL_CALLS ?? 1),
    aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 15000),
    aiMaxRetries: Number(process.env.AI_MAX_RETRIES ?? 1),
    aiVoiceReplyTemperature: Number(
      process.env.AI_VOICE_REPLY_TEMPERATURE ?? 0.6,
    ),
    aiExtractionTemperature: Number(
      process.env.AI_EXTRACTION_TEMPERATURE ?? 0.1,
    ),
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    adminApiToken: process.env.ADMIN_API_TOKEN ?? "changeme-admin-token",
    devAuthEnabled:
      (process.env.DEV_AUTH_ENABLED ?? "false").toLowerCase() === "true",
    devAuthSecret: process.env.DEV_AUTH_SECRET ?? "dev-auth-secret",
    identityIssuer:
      process.env.IDENTITY_ISSUER ??
      process.env.FIREBASE_ISSUER ??
      "",
    identityAudience:
      process.env.IDENTITY_AUDIENCE ??
      process.env.FIREBASE_AUDIENCE ??
      "",
    firebaseProjectId:
      process.env.FIREBASE_ADMIN_PROJECT_ID ??
      process.env.FIREBASE_PROJECT_ID ??
      process.env.GOOGLE_CLOUD_PROJECT,
    googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT ?? "",
    voiceEnabled:
      (process.env.VOICE_ENABLED ?? "false").toLowerCase() === "true",
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
    twilioSignatureCheck:
      (process.env.TWILIO_SIGNATURE_CHECK ?? "true").toLowerCase() === "true",
    twilioWebhookBaseUrl: process.env.TWILIO_WEBHOOK_BASE_URL ?? "",
    demoTenantId: process.env.DEMO_TENANT_ID ?? "",
    voiceMaxTurns: Number(process.env.VOICE_MAX_TURNS ?? 6),
    voiceMaxDurationSec: Number(process.env.VOICE_MAX_DURATION_SEC ?? 180),
    voiceAddressMinConfidence: Number(
      process.env.VOICE_ADDRESS_MIN_CONFIDENCE ?? 0.7,
    ),
    voiceSoftConfirmMinConfidence: Number(
      process.env.VOICE_SOFT_CONFIRM_MIN_CONFIDENCE ?? 0.85,
    ),
    voiceStreamingEnabled:
      (process.env.VOICE_STREAMING_ENABLED ?? "false").toLowerCase() === "true",
    voiceStreamingKeepAliveSec: Number(
      process.env.VOICE_STREAMING_KEEPALIVE_SEC ?? 60,
    ),
    voiceStreamingTrack: (process.env.VOICE_STREAMING_TRACK ??
      "inbound") as AppConfig["voiceStreamingTrack"],
    voiceSttProvider,
    voiceTtsProvider,
    addressValidationProvider:
      (process.env.ADDRESS_VALIDATION_PROVIDER ?? "none").toLowerCase() ===
      "google"
        ? "google"
        : "none",
    googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
    googleSpeechEnabled,
    googleSpeechLanguageCode: process.env.GOOGLE_SPEECH_LANGUAGE_CODE ?? "en-US",
    googleSpeechModel: process.env.GOOGLE_SPEECH_MODEL ?? "phone_call",
    googleSpeechUseEnhanced:
      (process.env.GOOGLE_SPEECH_USE_ENHANCED ?? "true").toLowerCase() === "true",
    googleSpeechEncoding: (process.env.GOOGLE_SPEECH_ENCODING ??
      "MULAW") as AppConfig["googleSpeechEncoding"],
    googleSpeechSampleRateHz: Number(
      process.env.GOOGLE_SPEECH_SAMPLE_RATE_HZ ?? 8000,
    ),
    googleSpeechInterimResults:
      (process.env.GOOGLE_SPEECH_INTERIM_RESULTS ?? "true").toLowerCase() ===
      "true",
    googleTtsEnabled,
    googleTtsLanguageCode: process.env.GOOGLE_TTS_LANGUAGE_CODE ?? "en-US",
    googleTtsVoiceName: process.env.GOOGLE_TTS_VOICE_NAME ?? "en-US-Studio-O",
    googleTtsAudioEncoding: (process.env.GOOGLE_TTS_AUDIO_ENCODING ??
      "MP3") as AppConfig["googleTtsAudioEncoding"],
    googleTtsSpeakingRate: Number(
      process.env.GOOGLE_TTS_SPEAKING_RATE ?? 1,
    ),
    googleTtsPitch: Number(process.env.GOOGLE_TTS_PITCH ?? 0),
    googleTtsVolumeGainDb: Number(process.env.GOOGLE_TTS_VOLUME_GAIN_DB ?? 0),
    googleTtsBucket: process.env.GOOGLE_TTS_BUCKET ?? "",
    googleTtsSignedUrlTtlSec: Number(
      process.env.GOOGLE_TTS_SIGNED_URL_TTL_SEC ?? 900,
    ),
    corsOrigins,
  };
});
