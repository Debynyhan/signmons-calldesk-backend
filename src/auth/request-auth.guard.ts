import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../config/app.config";
import { setAuthContext } from "../common/context/request-context";

type JwtClaims = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  role?: string;
  tenantId?: string;
  tenant_id?: string;
  user_id?: string;
};

@Injectable()
export class RequestAuthGuard implements CanActivate {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (this.config.devAuthEnabled) {
      return this.handleDevAuth(request);
    }

    return this.handleJwtAuth(request);
  }

  private handleDevAuth(request: Request): boolean {
    const providedSecret = request.header("x-dev-auth") ?? "";
    if (!providedSecret || providedSecret !== this.config.devAuthSecret) {
      throw new UnauthorizedException("Dev auth token mismatch.");
    }

    const tenantId = request.header("x-dev-tenant-id") ?? undefined;
    const userId = request.header("x-dev-user-id") ?? "dev-user";
    const role = request.header("x-dev-role") ?? "admin";

    setAuthContext({ userId, tenantId, role });
    return true;
  }

  private handleJwtAuth(request: Request): boolean {
    if (!this.config.identityIssuer || !this.config.identityAudience) {
      throw new UnauthorizedException("Identity configuration is missing.");
    }

    const authHeader = request.header("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const token = authHeader.slice("Bearer ".length).trim();
    // NOTE: Replace with verified JWT (e.g., jose) before production rollout.
    const claims = decodeJwtPayload(token);
    if (!claims) {
      throw new UnauthorizedException("Invalid bearer token.");
    }

    if (claims.iss !== this.config.identityIssuer) {
      throw new UnauthorizedException("Invalid token issuer.");
    }

    const audience = claims.aud;
    const expectedAudience = this.config.identityAudience;
    const matchesAudience = Array.isArray(audience)
      ? audience.includes(expectedAudience)
      : audience === expectedAudience;
    if (!matchesAudience) {
      throw new UnauthorizedException("Invalid token audience.");
    }

    const tenantId = claims.tenantId ?? claims.tenant_id;
    const userId = claims.sub ?? claims.user_id;
    if (!tenantId || !userId) {
      throw new UnauthorizedException("Missing tenant identity.");
    }

    setAuthContext({ userId, tenantId, role: claims.role });
    return true;
  }
}

function decodeJwtPayload(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload) as JwtClaims;
  } catch {
    return null;
  }
}
