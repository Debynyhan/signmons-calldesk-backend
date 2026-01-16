import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { ConfigType } from "@nestjs/config";
import type { DecodedIdToken } from "firebase-admin/auth";
import appConfig from "../config/app.config";
import { setAuthContext } from "../common/context/request-context";
import { FirebaseAdminService } from "./firebase-admin.service";

@Injectable()
export class RequestAuthGuard implements CanActivate {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (this.config.devAuthEnabled) {
      if (this.config.environment === "production") {
        throw new ForbiddenException("Dev auth is disabled in production.");
      }
      return this.handleDevAuth(request);
    }

    if (this.hasDevHeaders(request)) {
      throw new ForbiddenException("Dev auth headers are not allowed.");
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

  private hasDevHeaders(request: Request): boolean {
    return (
      request.header("x-dev-auth") !== undefined ||
      request.header("x-dev-role") !== undefined ||
      request.header("x-dev-user-id") !== undefined ||
      request.header("x-dev-tenant-id") !== undefined
    );
  }

  private async handleJwtAuth(request: Request): Promise<boolean> {
    const authHeader = request.header("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const claims = await this.verifyFirebaseToken(token);

    const tenantId = claims.tenantId ?? claims.tenant_id;
    const userId = claims.sub ?? claims.user_id ?? claims.uid;
    if (!tenantId || !userId) {
      throw new UnauthorizedException("Missing tenant identity.");
    }
    if (!claims.role) {
      throw new UnauthorizedException("Missing role claim.");
    }

    setAuthContext({ userId, tenantId, role: claims.role });
    return true;
  }

  private async verifyFirebaseToken(
    token: string,
  ): Promise<DecodedIdToken> {
    try {
      const claims = await this.firebaseAdmin
        .getAuth()
        .verifyIdToken(token, true);
      verifyIssuerAndAudience(
        claims,
        this.config.identityIssuer,
        this.config.identityAudience,
      );
      return claims;
    } catch {
      throw new UnauthorizedException("Invalid bearer token.");
    }
  }
}

function verifyIssuerAndAudience(
  claims: DecodedIdToken,
  issuer?: string,
  audience?: string,
): void {
  if (issuer && claims.iss !== issuer) {
    throw new UnauthorizedException("Invalid token issuer.");
  }
  if (audience && claims.aud !== audience) {
    throw new UnauthorizedException("Invalid token audience.");
  }
}
