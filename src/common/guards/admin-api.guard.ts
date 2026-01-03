import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createSecretKey } from "crypto";
import { Request } from "express";
import { jwtVerify, type JWTPayload } from "jose";
import { ConfigType } from "@nestjs/config";
import appConfig from "../../config/app.config";

@Injectable()
export class AdminApiGuard implements CanActivate {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const providedToken =
      request.header("x-admin-token") ?? request.header("x-admin-api-key");
    if (!providedToken) {
      throw new UnauthorizedException("Missing admin token.");
    }

    const key = this.config.adminJwtSecret
      ? createSecretKey(Buffer.from(this.config.adminJwtSecret, "utf-8"))
      : null;
    if (!key) {
      throw new UnauthorizedException("Admin token configuration missing.");
    }

    let payload: JWTPayload;
    try {
      const result = await jwtVerify(providedToken, key, {
        issuer: this.config.adminJwtIssuer,
        audience: this.config.adminJwtAudience,
        algorithms: ["HS256"],
      });
      payload = result.payload;
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : undefined;
      throw new UnauthorizedException("Invalid or expired admin token.", {
        cause,
      });
    }

    const role = this.readClaim(payload, ["role", "https://signmons.app/role"]);
    if (role !== "admin") {
      throw new UnauthorizedException("Admin role is required.");
    }

    return true;
  }

  private readClaim(payload: JWTPayload, keys: string[]): string | null {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value.length) {
        return value;
      }
    }
    return null;
  }
}
