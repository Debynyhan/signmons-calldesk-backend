import { registerAs } from "@nestjs/config";

export type NodeEnvironment = "development" | "production" | "test";

export interface AppConfig {
  environment: NodeEnvironment;
  openAiApiKey: string;
  enablePreviewModel: boolean;
  enabledTools: string[];
  aiTemperature: number;
  aiTopP: number;
  aiPresencePenalty: number;
  aiFrequencyPenalty: number;
  aiMaxTokens: number;
  port: number;
  databaseUrl: string;
  adminApiToken: string;
  corsOrigins: string[];
  corsWildcardOrigins: string[];
}

const DEFAULT_DATABASE_URL =
  "postgresql://signmons:Signmons-calldesk-backend-v1@localhost:5432/postgres?schema=calldesk";
const DEFAULT_CORS_ORIGINS = ["http://localhost:3000", "http://localhost:3101"];

export default registerAs("app", (): AppConfig => {
  const rawOrigins =
    process.env.FRONTEND_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  const effectiveOrigins =
    rawOrigins.length > 0 ? rawOrigins : DEFAULT_CORS_ORIGINS;

  const corsOrigins: string[] = [];
  const corsWildcardOrigins: string[] = [];
  for (const origin of effectiveOrigins) {
    const normalized = origin.replace(/\/$/, "");
    const wildcardMatch = normalized.match(
      /^(https?:\/\/)?\*\.(?<domain>.+)$/i,
    );
    if (wildcardMatch?.groups?.domain) {
      corsWildcardOrigins.push(wildcardMatch.groups.domain.toLowerCase());
      continue;
    }
    corsOrigins.push(normalized);
  }

  return {
    environment: (process.env.NODE_ENV as NodeEnvironment) ?? "development",
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
    enablePreviewModel:
      (process.env.ENABLE_GPT5_1_CODEX ?? "false").toLowerCase() === "true",
    enabledTools: (process.env.ENABLED_TOOLS ?? "create_job")
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean),
    aiTemperature: Number(process.env.AI_TEMPERATURE ?? 0.3),
    aiTopP: Number(process.env.AI_TOP_P ?? 1),
    aiPresencePenalty: Number(process.env.AI_PRESENCE_PENALTY ?? 0),
    aiFrequencyPenalty: Number(process.env.AI_FREQUENCY_PENALTY ?? 0),
    aiMaxTokens: Number(process.env.AI_MAX_TOKENS ?? 220),
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    adminApiToken: process.env.ADMIN_API_TOKEN ?? "changeme-admin-token",
    corsOrigins,
    corsWildcardOrigins,
  };
});
