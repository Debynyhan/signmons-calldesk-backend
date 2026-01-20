import * as Joi from "joi";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  OPENAI_API_KEY: Joi.string().min(10).required(),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgres", "postgresql"] })
    .default(
      "postgresql://signmons:Signmons-calldesk-backend-v1@localhost:5432/postgres?schema=calldesk",
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
  GOOGLE_APPLICATION_CREDENTIALS: Joi.string().allow("").default(""),
  ENABLE_GPT5_1_CODEX: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  ENABLED_TOOLS: Joi.string().default("create_job"),
  AI_MAX_TOKENS: Joi.number().min(1).max(8000).default(800),
  AI_MAX_TOOL_CALLS: Joi.number().min(0).max(5).default(1),
  AI_TIMEOUT_MS: Joi.number().min(1000).max(60000).default(15000),
  AI_MAX_RETRIES: Joi.number().min(0).max(5).default(1),
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
  VOICE_MAX_TURNS: Joi.number().min(1).max(50).default(6),
  VOICE_MAX_DURATION_SEC: Joi.number().min(30).max(3600).default(180),
  VOICE_ADDRESS_MIN_CONFIDENCE: Joi.number().min(0).max(1).default(0.7),
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
  return values;
});
