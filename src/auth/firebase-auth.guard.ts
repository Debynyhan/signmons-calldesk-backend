import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyResult,
} from "jose";
import type { Request } from "express";
import appConfig from "../config/app.config";
import { setAuthContext } from "../common/context/request-context";
import { LoggingService } from "../logging/logging.service";

const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export interface AuthenticatedUser {
  userId: string;
  tenantId?: string;
  role?: string;
  claims: Record<string, unknown>;
  token: string;
}

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly loggingService: LoggingService,
  ) {
    const jwksUrl = new URL(FIREBASE_JWKS_URL);
    this.jwks = createRemoteJWKSet(jwksUrl);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const app = this.config;
    if (!app) {
      throw new UnauthorizedException("Identity configuration is missing.");
    }

    const devAuthUser = this.tryDevAuth(request, app);
    if (devAuthUser) {
      const impersonatedTenant = this.readImpersonatedTenant(request);
      setAuthContext(devAuthUser, impersonatedTenant);
      (request as Request & { authUser?: AuthenticatedUser }).authUser =
        devAuthUser;
      this.loggingService.warn(
        "Dev auth accepted for request.",
        "FirebaseAuthGuard",
      );
      return true;
    }

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    if (!app.identityIssuer || !app.identityAudience) {
      throw new UnauthorizedException("Identity configuration is missing.");
    }

    const verified: JWTVerifyResult<JWTPayload> = await this.verifyToken(
      token,
      app.identityIssuer,
      app.identityAudience,
    );
    const impersonatedTenant = this.readImpersonatedTenant(request);
    const authUser = this.mapUser(verified, token, impersonatedTenant);
    setAuthContext(authUser, impersonatedTenant);

    if (impersonatedTenant) {
      this.loggingService.warn(
        `Admin impersonation requested for tenant ${impersonatedTenant}`,
        "FirebaseAuthGuard",
      );
      this.loggingService.log(
        `Audit: user ${authUser.userId} impersonating tenant ${impersonatedTenant}`,
        "Audit",
      );
    }

    // Attach to request for downstream guards/controllers
    (request as Request & { authUser?: AuthenticatedUser }).authUser = authUser;
    return true;
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice("Bearer ".length).trim();
    }
    const altHeader = request.headers["x-id-token"];
    if (typeof altHeader === "string" && altHeader.length) {
      return altHeader.trim();
    }
    return null;
  }

  private async verifyToken(
    token: string,
    issuer: string,
    audience: string,
  ): Promise<JWTVerifyResult<JWTPayload>> {
    let result: JWTVerifyResult<JWTPayload>;
    try {
      result = await jwtVerify<JWTPayload>(token, this.jwks, {
        issuer,
        audience,
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : undefined;
      throw new UnauthorizedException("Invalid or expired token.", {
        cause: err,
      });
    }
    return result;
  }

  private mapUser(
    result: JWTVerifyResult<JWTPayload>,
    token: string,
    impersonatedTenantId?: string | null,
  ): AuthenticatedUser {
    const payloadRaw = result.payload ?? {};
    const payload: JWTPayload & Record<string, unknown> =
      typeof payloadRaw === "object" && payloadRaw !== null
        ? (payloadRaw as JWTPayload & Record<string, unknown>)
        : {};

    const userId = typeof payload.sub === "string" ? payload.sub : "";
    if (!userId) {
      throw new UnauthorizedException("Token subject is missing.");
    }

    const tenantId =
      impersonatedTenantId ??
      this.readClaim(payload, [
        "tenantId",
        "tenant_id",
        "https://signmons.app/tenantId",
      ]);
    const role = this.readClaim(payload, ["role", "https://signmons.app/role"]);

    return {
      userId,
      tenantId: tenantId ?? undefined,
      role: role ?? undefined,
      claims: { ...payload },
      token,
    };
  }

  private readClaim(
    payload: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value.length) {
        return value;
      }
    }
    return null;
  }

  private readImpersonatedTenant(request: Request): string | null {
    const raw = request.headers["x-impersonated-tenant"];
    if (typeof raw !== "string" || !raw.trim().length) {
      return null;
    }
    const tenantId = raw.trim();

    this.loggingService.warn(
      `Admin impersonation requested for tenant ${tenantId}`,
      "FirebaseAuthGuard",
    );

    return tenantId;
  }

  private tryDevAuth(
    request: Request,
    app: ConfigType<typeof appConfig>,
  ): AuthenticatedUser | null {
    const envEnabled =
      (process.env.DEV_AUTH_ENABLED ?? "").toLowerCase() === "true";
    const devAuthEnabled = app.devAuthEnabled || envEnabled;
    const devAuthSecret =
      app.devAuthSecret || process.env.DEV_AUTH_SECRET || "";

    if (!devAuthEnabled) {
      const hasHeader =
        typeof request.headers["x-dev-auth"] === "string" &&
        Boolean(request.headers["x-dev-auth"].trim());
      if (hasHeader) {
        this.loggingService.warn(
          "Dev auth header received but dev auth is disabled.",
          "FirebaseAuthGuard",
        );
      }
      return null;
    }

    const rawToken = request.headers["x-dev-auth"];
    if (typeof rawToken !== "string" || !rawToken.trim()) {
      return null;
    }
    const token = rawToken.trim();
    if (!devAuthSecret || token !== devAuthSecret) {
      this.loggingService.warn("Dev auth token mismatch.", "FirebaseAuthGuard");
      return null;
    }

    const rawTenant = request.headers["x-dev-tenant-id"];
    const rawRole = request.headers["x-dev-role"];
    const rawUserId = request.headers["x-dev-user-id"];

    const tenantId =
      typeof rawTenant === "string" && rawTenant.trim().length
        ? rawTenant.trim()
        : undefined;
    const role =
      typeof rawRole === "string" && rawRole.trim().length
        ? rawRole.trim().toLowerCase()
        : "admin";
    const userId =
      typeof rawUserId === "string" && rawUserId.trim().length
        ? rawUserId.trim()
        : "dev-user";

    return {
      userId,
      tenantId,
      role,
      claims: { devAuth: true },
      token: "dev-auth",
    };
  }
}
