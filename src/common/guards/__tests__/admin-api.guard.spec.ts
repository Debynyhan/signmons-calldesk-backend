import { UnauthorizedException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common/interfaces";
import { createSecretKey } from "crypto";
import { SignJWT } from "jose";
import { AdminApiGuard } from "../admin-api.guard";
import appConfig from "../../../config/app.config";

describe("AdminApiGuard", () => {
  const secret = "test-admin-jwt-secret-please-change";
  const issuer = "signmons-admin";
  const audience = "admin-api";
  const baseConfig: ReturnType<typeof appConfig> = {
    environment: "test",
    aiProvider: "openai",
    openAiApiKey: "test",
    vertexProjectId: "project",
    vertexLocation: "us-central1",
    vertexModel: "gemini-1.5-pro",
    enablePreviewModel: false,
    enabledTools: [],
    port: 3000,
    databaseUrl: "postgres://user:pass@localhost:5432/db",
    adminJwtSecret: secret,
    adminJwtIssuer: issuer,
    adminJwtAudience: audience,
    corsOrigins: [],
    identityProjectId: "signmons",
    identityIssuer: "https://issuer.example.com",
    identityAudience: "signmons",
  };

  const makeContext = (headers: Record<string, string>): ExecutionContext => {
    const request = { header: (name: string) => headers[name.toLowerCase()] };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  const signToken = async (claims: Record<string, unknown> = {}) => {
    const key = createSecretKey(Buffer.from(secret, "utf-8"));
    return new SignJWT({ role: "admin", ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("admin-user")
      .setExpirationTime("1h")
      .sign(key);
  };

  it("allows valid admin JWT", async () => {
    const token = await signToken();
    const guard = new AdminApiGuard(baseConfig);
    const context = makeContext({ "x-admin-token": token });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("rejects when admin token is missing", async () => {
    const guard = new AdminApiGuard(baseConfig);
    const context = makeContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects invalid signature", async () => {
    const badToken = await signToken({ role: "admin" });
    const guard = new AdminApiGuard({ ...baseConfig, adminJwtSecret: "wrong" });
    const context = makeContext({ "x-admin-token": badToken });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects non-admin role", async () => {
    const token = await signToken({ role: "user" });
    const guard = new AdminApiGuard(baseConfig);
    const context = makeContext({ "x-admin-token": token });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
