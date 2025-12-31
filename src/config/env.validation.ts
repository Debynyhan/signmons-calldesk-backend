import * as Joi from "joi";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  AI_PROVIDER: Joi.string().valid("openai", "vertex").default("openai"),
  OPENAI_API_KEY: Joi.string()
    .min(10)
    .when("AI_PROVIDER", {
      is: "openai",
      then: Joi.required(),
      otherwise: Joi.optional().allow(""),
    }),
  VERTEX_AI_PROJECT_ID: Joi.string().when("AI_PROVIDER", {
    is: "vertex",
    then: Joi.required(),
    otherwise: Joi.optional().allow(""),
  }),
  VERTEX_AI_LOCATION: Joi.string().default("us-central1"),
  VERTEX_AI_MODEL: Joi.string().default("gemini-1.5-pro"),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgres", "postgresql"] })
    .default(
      "postgresql://signmons:Signmons-calldesk-backend-v1@localhost:5432/postgres?schema=calldesk",
    ),
  ADMIN_API_TOKEN: Joi.string().min(12).default("changeme-admin-token"),
  ENABLE_GPT5_1_CODEX: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  ENABLED_TOOLS: Joi.string().default("create_job"),
  PORT: Joi.number().min(0).max(65535).default(3000),
});
