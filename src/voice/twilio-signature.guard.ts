import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { validateRequest } from "twilio";
import appConfig, { type AppConfig } from "../config/app.config";

@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.shouldVerifySignature()) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const signature = req.header("x-twilio-signature");
    if (!signature) {
      throw new UnauthorizedException("Missing Twilio signature.");
    }

    const baseUrl = this.config.twilioWebhookBaseUrl;
    if (!baseUrl) {
      throw new UnauthorizedException("Webhook base URL not configured.");
    }

    const url = `${baseUrl.replace(/\/$/, "")}${req.originalUrl}`;
    const params = (req.body ?? {}) as Record<string, unknown>;
    const isValid = validateRequest(
      this.config.twilioAuthToken,
      signature,
      url,
      params,
    );

    if (!isValid) {
      throw new UnauthorizedException("Invalid Twilio signature.");
    }

    return true;
  }

  private shouldVerifySignature(): boolean {
    return (
      this.config.environment === "production" &&
      this.config.twilioSignatureCheck
    );
  }
}
