import * as Joi from "joi";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  OPENAI_API_KEY: Joi.string().min(10).required(),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgres", "postgresql"] })
    .default(
      "postgresql://calldesk:call_backend_v1@localhost:5432/calldesk?schema=public",
    ),
  ADMIN_API_TOKEN: Joi.string().min(12).default("changeme-admin-token"),
  DEV_AUTH_ENABLED: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  DEV_AUTH_SECRET: Joi.string().min(8).default("dev-auth-secret"),
  IDENTITY_ISSUER: Joi.string().allow("").default(""),
  IDENTITY_AUDIENCE: Joi.string().allow("").default(""),
  FIREBASE_ADMIN_PROJECT_ID: Joi.string().allow("").default(""),
  FIREBASE_PROJECT_ID: Joi.string().allow("").default(""),
  FIREBASE_ISSUER: Joi.string().allow("").default(""),
  FIREBASE_AUDIENCE: Joi.string().allow("").default(""),
  GOOGLE_CLOUD_PROJECT: Joi.string().allow("").default(""),
  GOOGLE_APPLICATION_CREDENTIALS: Joi.string().allow("").default(""),
  GOOGLE_SPEECH_ENABLED: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  GOOGLE_SPEECH_LANGUAGE_CODE: Joi.string().default("en-US"),
  GOOGLE_SPEECH_MODEL: Joi.string().allow("").default("phone_call"),
  GOOGLE_SPEECH_USE_ENHANCED: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("true"),
  GOOGLE_SPEECH_ENCODING: Joi.string()
    .valid("MULAW", "LINEAR16", "OGG_OPUS")
    .default("MULAW"),
  GOOGLE_SPEECH_SAMPLE_RATE_HZ: Joi.number().min(8000).max(48000).default(8000),
  GOOGLE_SPEECH_INTERIM_RESULTS: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("true"),
  GOOGLE_TTS_ENABLED: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  GOOGLE_TTS_LANGUAGE_CODE: Joi.string().default("en-US"),
  GOOGLE_TTS_VOICE_NAME: Joi.string().default("en-US-Studio-O"),
  GOOGLE_TTS_AUDIO_ENCODING: Joi.string()
    .valid("MP3", "OGG_OPUS", "LINEAR16")
    .default("MP3"),
  GOOGLE_TTS_SPEAKING_RATE: Joi.number().min(0.25).max(4).default(1),
  GOOGLE_TTS_PITCH: Joi.number().min(-20).max(20).default(0),
  GOOGLE_TTS_VOLUME_GAIN_DB: Joi.number().min(-96).max(16).default(0),
  GOOGLE_TTS_BUCKET: Joi.string().allow("").default(""),
  GOOGLE_TTS_SIGNED_URL_TTL_SEC: Joi.number().min(60).max(3600).default(900),
  ENABLE_GPT5_1_CODEX: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  AI_DEFAULT_MODEL: Joi.string().min(1).default("gpt-4o-mini"),
  AI_PREVIEW_MODEL: Joi.string().min(1).default("gpt-5.1-codex"),
  AI_TEXT_MODEL: Joi.string().allow("").default(""),
  AI_VOICE_MODEL: Joi.string().allow("").default(""),
  AI_ROUTER_MODEL: Joi.string().allow("").default(""),
  AI_BOOKING_MODEL: Joi.string().allow("").default(""),
  AI_FAQ_MODEL: Joi.string().allow("").default(""),
  AI_EXTRACTION_MODEL: Joi.string().allow("").default(""),
  AI_ROUTER_FLOW_ENABLED: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("true"),
  AI_ROUTER_FLOW_SMS_ENABLED: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("true"),
  AI_ROUTER_FLOW_WEBCHAT_ENABLED: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("true"),
  AI_ROUTER_FLOW_ALLOWLIST_ONLY: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  AI_ROUTER_FLOW_TENANT_ALLOWLIST: Joi.string().allow("").default(""),
  ENABLED_TOOLS: Joi.string().default("route_conversation,create_job"),
  AI_MAX_TOKENS: Joi.number().min(1).max(8000).default(800),
  AI_MAX_TOOL_CALLS: Joi.number().min(0).max(5).default(1),
  AI_TIMEOUT_MS: Joi.number().min(1000).max(60000).default(15000),
  AI_MAX_RETRIES: Joi.number().min(0).max(5).default(1),
  AI_VOICE_REPLY_TEMPERATURE: Joi.number().min(0).max(1).default(0.6),
  AI_EXTRACTION_TEMPERATURE: Joi.number().min(0).max(1).default(0.1),
  VOICE_ENABLED: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  TWILIO_ACCOUNT_SID: Joi.string().allow("").default(""),
  TWILIO_AUTH_TOKEN: Joi.string().allow("").default(""),
  TWILIO_PHONE_NUMBER: Joi.string().allow("").default(""),
  TWILIO_SIGNATURE_CHECK: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("true"),
  TWILIO_WEBHOOK_BASE_URL: Joi.string().allow("").default(""),
  STRIPE_SECRET_KEY: Joi.string().allow("").default(""),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow("").default(""),
  STRIPE_CONNECT_CLIENT_ID: Joi.string().allow("").default(""),
  SMS_INTAKE_LINK_SECRET: Joi.string().allow("").default(""),
  SMS_INTAKE_LINK_TTL_MINUTES: Joi.number().min(5).max(10080).default(1440),
  SMS_INTAKE_BASE_URL: Joi.string().allow("").default(""),
  DEMO_TENANT_ID: Joi.string().allow("").default(""),
  VOICE_MAX_TURNS: Joi.number().min(1).max(50).default(6),
  VOICE_MAX_DURATION_SEC: Joi.number().min(30).max(3600).default(180),
  VOICE_ADDRESS_MIN_CONFIDENCE: Joi.number().min(0).max(1).default(0.7),
  VOICE_SOFT_CONFIRM_MIN_CONFIDENCE: Joi.number().min(0).max(1).default(0.85),
  VOICE_STREAMING_ENABLED: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  VOICE_STREAMING_KEEPALIVE_SEC: Joi.number().min(5).max(600).default(60),
  VOICE_STREAMING_TRACK: Joi.string()
    .valid("inbound", "both")
    .default("inbound"),
  VOICE_STT_PROVIDER: Joi.string()
    .valid("twilio", "google", "TWILIO", "GOOGLE", "")
    .default(""),
  VOICE_TTS_PROVIDER: Joi.string()
    .valid("twilio", "google", "TWILIO", "GOOGLE", "")
    .default(""),
  VOICE_TTS_SHORT_SAY_MAX_CHARS: Joi.number().min(0).max(400).default(0),
  ADDRESS_VALIDATION_PROVIDER: Joi.string()
    .valid("none", "google")
    .default("none"),
  GOOGLE_PLACES_API_KEY: Joi.string().allow("").default(""),
  PORT: Joi.number().min(0).max(65535).default(3000),
}).custom((values, helpers) => {
  if (
    values.NODE_ENV === "production" &&
    String(values.DEV_AUTH_ENABLED).toLowerCase() === "true"
  ) {
    return helpers.error("any.invalid", {
      message: "DEV_AUTH_ENABLED cannot be true in production.",
    });
  }
  if (String(values.VOICE_ENABLED).toLowerCase() === "true") {
    const missing = [];
    if (!values.TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
    if (!values.TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
    if (!values.TWILIO_PHONE_NUMBER) missing.push("TWILIO_PHONE_NUMBER");
    if (!values.TWILIO_WEBHOOK_BASE_URL)
      missing.push("TWILIO_WEBHOOK_BASE_URL");
    if (missing.length) {
      return helpers.error("any.invalid", {
        message: `VOICE_ENABLED=true requires: ${missing.join(", ")}`,
      });
    }
  }
  if (values.STRIPE_WEBHOOK_SECRET && !values.STRIPE_SECRET_KEY) {
    return helpers.error("any.invalid", {
      message: "STRIPE_WEBHOOK_SECRET requires STRIPE_SECRET_KEY.",
    });
  }
  if (values.ADDRESS_VALIDATION_PROVIDER === "google") {
    if (!values.GOOGLE_PLACES_API_KEY) {
      return helpers.error("any.invalid", {
        message:
          "ADDRESS_VALIDATION_PROVIDER=google requires GOOGLE_PLACES_API_KEY.",
      });
    }
  }
  if (String(values.GOOGLE_TTS_ENABLED).toLowerCase() === "true") {
    if (!values.GOOGLE_TTS_BUCKET) {
      return helpers.error("any.invalid", {
        message: "GOOGLE_TTS_ENABLED=true requires GOOGLE_TTS_BUCKET.",
      });
    }
  }
  if (String(values.VOICE_STT_PROVIDER).toLowerCase() === "google") {
    if (String(values.GOOGLE_SPEECH_ENABLED).toLowerCase() !== "true") {
      return helpers.error("any.invalid", {
        message:
          "VOICE_STT_PROVIDER=google requires GOOGLE_SPEECH_ENABLED=true.",
      });
    }
  }
  if (String(values.VOICE_TTS_PROVIDER).toLowerCase() === "google") {
    if (String(values.GOOGLE_TTS_ENABLED).toLowerCase() !== "true") {
      return helpers.error("any.invalid", {
        message:
          "VOICE_TTS_PROVIDER=google requires GOOGLE_TTS_ENABLED=true.",
      });
    }
  }
  return values;
});
