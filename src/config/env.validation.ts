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
  ENABLE_GPT5_1_CODEX: Joi.string()
    .valid("true", "false", "TRUE", "FALSE")
    .default("false"),
  ENABLED_TOOLS: Joi.string().default("create_job"),
  PORT: Joi.number().min(0).max(65535).default(3000),
});
