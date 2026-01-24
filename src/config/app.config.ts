import { registerAs } from "@nestjs/config";

export type NodeEnvironment = "development" | "production" | "test";

export interface AppConfig {
  environment: NodeEnvironment;
  openAiApiKey: string;
  enablePreviewModel: boolean;
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
  voiceEnabled: boolean;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  twilioSignatureCheck: boolean;
  twilioWebhookBaseUrl: string;
  voiceMaxTurns: number;
  voiceMaxDurationSec: number;
  voiceAddressMinConfidence: number;
  voiceSoftConfirmMinConfidence: number;
  addressValidationProvider: "none" | "google";
  googlePlacesApiKey: string;
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

  return {
    environment: (process.env.NODE_ENV as NodeEnvironment) ?? "development",
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
    enablePreviewModel:
      (process.env.ENABLE_GPT5_1_CODEX ?? "false").toLowerCase() === "true",
    enabledTools: (process.env.ENABLED_TOOLS ?? "create_job")
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
    voiceEnabled:
      (process.env.VOICE_ENABLED ?? "false").toLowerCase() === "true",
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
    twilioSignatureCheck:
      (process.env.TWILIO_SIGNATURE_CHECK ?? "true").toLowerCase() === "true",
    twilioWebhookBaseUrl: process.env.TWILIO_WEBHOOK_BASE_URL ?? "",
    voiceMaxTurns: Number(process.env.VOICE_MAX_TURNS ?? 6),
    voiceMaxDurationSec: Number(process.env.VOICE_MAX_DURATION_SEC ?? 180),
    voiceAddressMinConfidence: Number(
      process.env.VOICE_ADDRESS_MIN_CONFIDENCE ?? 0.7,
    ),
    voiceSoftConfirmMinConfidence: Number(
      process.env.VOICE_SOFT_CONFIRM_MIN_CONFIDENCE ?? 0.85,
    ),
    addressValidationProvider:
      (process.env.ADDRESS_VALIDATION_PROVIDER ?? "none").toLowerCase() ===
      "google"
        ? "google"
        : "none",
    googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
    corsOrigins,
  };
});
