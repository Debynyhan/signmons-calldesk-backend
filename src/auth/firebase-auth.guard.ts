import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService, ConfigType } from "@nestjs/config";
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
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
  ) {
    const jwksUrl = new URL(FIREBASE_JWKS_URL);
    this.jwks = createRemoteJWKSet(jwksUrl);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const app = this.configService.get<ConfigType<typeof appConfig>>(
      appConfig.KEY,
    );
    if (!app?.identityIssuer || !app.identityAudience) {
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
}
