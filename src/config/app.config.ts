import { registerAs } from "@nestjs/config";

export type NodeEnvironment = "development" | "production" | "test";

export interface AppConfig {
  environment: NodeEnvironment;
  openAiApiKey: string;
  enablePreviewModel: boolean;
  enabledTools: string[];
  port: number;
  databaseUrl: string;
  adminApiToken: string;
}

const DEFAULT_DATABASE_URL =
  "postgresql://signmons:Signmons-calldesk-backend-v1@localhost:5432/postgres?schema=calldesk";

export default registerAs(
  "app",
  (): AppConfig => ({
    environment: (process.env.NODE_ENV as NodeEnvironment) ?? "development",
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
    enablePreviewModel:
      (process.env.ENABLE_GPT5_1_CODEX ?? "false").toLowerCase() === "true",
    enabledTools: (process.env.ENABLED_TOOLS ?? "create_job")
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean),
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    adminApiToken: process.env.ADMIN_API_TOKEN ?? "changeme-admin-token",
  }),
);
