import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { validateRequest } from "twilio";
import appConfig, { type AppConfig } from "../config/app.config";
import { MarketingService } from "./marketing.service";
import { TryDemoDto } from "./dto/try-demo.dto";

@Controller("api/marketing")
export class MarketingController {
  private readonly logger = new Logger(MarketingController.name);
  private insecureBypassWarned = false;

  constructor(
    private readonly marketingService: MarketingService,
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
  ) {}

  @Post("try-demo")
  @HttpCode(202)
  async submitTryDemo(@Body() payload: TryDemoDto) {
    return this.marketingService.submitTryDemo(payload);
  }

  @Post("try-demo/status")
  @HttpCode(204)
  async handleTryDemoStatus(
    @Req() req: Request,
    @Query("leadId") leadId?: string,
  ) {
    this.verifySignature(req);
    await this.marketingService.handleTryDemoStatusCallback(
      (req.body ?? {}) as Record<string, string | undefined>,
      leadId,
    );
  }

  @Get("try-demo/:leadId")
  async getTryDemoStatus(@Param("leadId") leadId: string) {
    return this.marketingService.getTryDemoStatus(leadId);
  }

  private shouldVerifySignature(): boolean {
    if (!this.config.twilioSignatureCheck) {
      return false;
    }
    const insecureLocalBypassEnabled =
      this.config.environment === "development" &&
      this.config.twilioSignatureAllowInsecureLocal;
    if (insecureLocalBypassEnabled && !this.insecureBypassWarned) {
      this.logger.warn(
        "Twilio signature verification bypass is enabled for local development.",
      );
      this.insecureBypassWarned = true;
      return false;
    }
    return !insecureLocalBypassEnabled;
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
}
