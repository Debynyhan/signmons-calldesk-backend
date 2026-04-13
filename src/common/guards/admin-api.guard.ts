import { timingSafeEqual } from "crypto";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../../config/app.config";

@Injectable()
export class AdminApiGuard implements CanActivate {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const providedToken =
      request.header("x-admin-token") ?? request.header("x-admin-api-key");
    const expected = this.config.adminApiToken;
    if (
      !providedToken ||
      !expected ||
      !this.safeCompare(providedToken, expected)
    ) {
      throw new UnauthorizedException("Unauthorized access to admin endpoint.");
    }
    return true;
  }

  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
