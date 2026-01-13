import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { ConfigType } from "@nestjs/config";
import appConfig from "../../config/app.config";

@Injectable()
export class AdminApiGuard implements CanActivate {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const devAuthEnabled = this.config.devAuthEnabled;
    const devAuthSecret = this.config.devAuthSecret;
    const devAuthHeader = request.header("x-dev-auth");
    const devRole = request.header("x-dev-role");
    const devUserId = request.header("x-dev-user-id");

    if (
      devAuthEnabled &&
      devAuthHeader &&
      devAuthHeader === devAuthSecret &&
      devRole === "admin" &&
      devUserId
    ) {
      return true;
    }

    const providedToken =
      request.header("x-admin-token") ?? request.header("x-admin-api-key");
    if (!providedToken || providedToken !== this.config.adminApiToken) {
      throw new UnauthorizedException("Unauthorized access to admin endpoint.");
    }
    return true;
  }
}
