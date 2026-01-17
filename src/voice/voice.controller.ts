import {
  Controller,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { validateRequest } from "twilio";
import appConfig, { type AppConfig } from "../config/app.config";

@Controller("api/voice")
export class VoiceController {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
  ) {}

  @Post("inbound")
  handleInbound(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.replyWithTwiml(res, this.disabledTwiml());
    }
    return this.replyWithTwiml(
      res,
      this.buildTwiml(
        "Thanks for calling. Voice intake is currently in setup. Please try again later.",
      ),
    );
  }

  @Post("turn")
  handleTurn(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.replyWithTwiml(res, this.disabledTwiml());
    }
    return this.replyWithTwiml(
      res,
      this.buildTwiml(
        "Thanks. We have captured your response. We'll follow up shortly.",
      ),
    );
  }

  @Post("fallback")
  handleFallback(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.replyWithTwiml(res, this.disabledTwiml());
    }
    return this.replyWithTwiml(
      res,
      this.buildTwiml(
        "We're having trouble handling your call. Please try again later.",
      ),
    );
  }

  @Post("status")
  handleStatus(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    return res.status(200).send();
  }

  private shouldVerifySignature(): boolean {
    return (
      this.config.environment === "production" &&
      this.config.twilioSignatureCheck
    );
  }

  private verifySignature(req: Request) {
    if (!this.shouldVerifySignature()) {
      return;
    }

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
  }

  private replyWithTwiml(res: Response, twiml: string) {
    return res.status(200).type("text/xml").send(twiml);
  }

  private disabledTwiml(): string {
    return this.buildTwiml(
      "Voice intake is currently unavailable. Please try again later.",
    );
  }

  private buildTwiml(message: string): string {
    const escaped = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escaped}</Say><Hangup/></Response>`;
  }
}
