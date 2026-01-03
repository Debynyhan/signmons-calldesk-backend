import { registerAs } from "@nestjs/config";

export type NodeEnvironment = "development" | "production" | "test";

export interface AppConfig {
  environment: NodeEnvironment;
  aiProvider: "openai" | "vertex";
  openAiApiKey: string;
  vertexProjectId: string;
  vertexLocation: string;
  vertexModel: string;
  enablePreviewModel: boolean;
  enabledTools: string[];
  port: number;
  databaseUrl: string;
  adminJwtSecret: string;
  adminJwtIssuer: string;
  adminJwtAudience: string;
  corsOrigins: string[];
  identityProjectId: string;
  identityIssuer: string;
  identityAudience: string;
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
  const identityProjectId = process.env.IDENTITY_PROJECT_ID ?? "signmons";
  const identityIssuer =
    process.env.IDENTITY_ISSUER ??
    `https://securetoken.google.com/${identityProjectId}`;
  const identityAudience = process.env.IDENTITY_AUDIENCE ?? identityProjectId;

  return {
    environment: (process.env.NODE_ENV as NodeEnvironment) ?? "development",
    aiProvider: (process.env.AI_PROVIDER as "openai" | "vertex") ?? "openai",
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
    vertexProjectId: process.env.VERTEX_AI_PROJECT_ID ?? "",
    vertexLocation: process.env.VERTEX_AI_LOCATION ?? "us-central1",
    vertexModel: process.env.VERTEX_AI_MODEL ?? "gemini-1.5-pro",
    enablePreviewModel:
      (process.env.ENABLE_GPT5_1_CODEX ?? "false").toLowerCase() === "true",
    enabledTools: (process.env.ENABLED_TOOLS ?? "create_job")
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean),
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    adminJwtSecret:
      process.env.ADMIN_JWT_SECRET ?? "changeme-admin-jwt-secret",
    adminJwtIssuer: process.env.ADMIN_JWT_ISSUER ?? "signmons-admin",
    adminJwtAudience: process.env.ADMIN_JWT_AUDIENCE ?? "admin-api",
    corsOrigins,
    identityProjectId,
    identityIssuer,
    identityAudience,
  };
});
