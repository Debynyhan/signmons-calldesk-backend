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
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { ConversationsService } from "../conversations/conversations.service";
import { CallLogService } from "../logging/call-log.service";

@Controller("api/voice")
export class VoiceController {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    private readonly conversationsService: ConversationsService,
    private readonly callLogService: CallLogService,
  ) {}

  @Post("inbound")
  async handleInbound(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.replyWithTwiml(res, this.disabledTwiml());
    }
    const toNumber = this.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    const callSid = this.extractCallSid(req);
    if (!callSid) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    const requestId = this.getRequestId(req);
    const callerPhone = this.extractFromNumber(req) ?? undefined;
    await this.conversationsService.ensureVoiceConsentConversation({
      tenantId: tenant.id,
      callSid,
      requestId,
      callerPhone,
    });
    return this.replyWithTwiml(
      res,
      this.buildConsentTwiml(),
    );
  }

  @Post("turn")
  async handleTurn(@Req() req: Request, @Res() res: Response) {
    this.verifySignature(req);
    if (!this.config.voiceEnabled) {
      return this.replyWithTwiml(res, this.disabledTwiml());
    }
    const toNumber = this.extractToNumber(req);
    const tenant = toNumber
      ? await this.tenantsService.resolveTenantByPhone(toNumber)
      : null;
    if (!tenant) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    const callSid = this.extractCallSid(req);
    if (!callSid) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    const conversation = await this.conversationsService.getVoiceConversationByCallSid(
      {
        tenantId: tenant.id,
        callSid,
      },
    );
    const consentGranted = Boolean(
      (conversation?.collectedData as { voiceConsent?: { granted?: boolean } })
        ?.voiceConsent?.granted,
    );
    if (!consentGranted) {
      return this.replyWithTwiml(res, this.unroutableTwiml());
    }
    const speechResult = this.extractSpeechResult(req);
    const normalizedSpeech = speechResult
      ? speechResult.replace(/\s+/g, " ").trim()
      : "";
    if (!normalizedSpeech) {
      return this.replyWithTwiml(res, this.buildRepromptTwiml());
    }
    const confidence = this.normalizeConfidence(this.extractConfidence(req));
    const updatedConversation = await this.conversationsService.updateVoiceTranscript({
      tenantId: tenant.id,
      callSid,
      transcript: normalizedSpeech,
      confidence,
    });
    if (updatedConversation) {
      await this.callLogService.createVoiceTranscriptLog({
        tenantId: tenant.id,
        conversationId: updatedConversation.id,
        callSid,
        transcript: normalizedSpeech,
        confidence,
        occurredAt: new Date(),
      });
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

  private unroutableTwiml(): string {
    return this.buildTwiml(
      "We're unable to route your call at this time.",
    );
  }

  private buildConsentTwiml(): string {
    const actionUrl = this.buildWebhookUrl("/api/voice/turn");
    const consent =
      "This call may be transcribed and handled by automated systems for service and quality purposes. By continuing, you consent to this process.";
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      consent,
    )}</Say><Gather input="speech" action="${this.escapeXml(
      actionUrl,
    )}" method="POST" timeout="5" speechTimeout="auto"/></Response>`;
  }

  private buildRepromptTwiml(): string {
    const actionUrl = this.buildWebhookUrl("/api/voice/turn");
    const message = "Sorry, I didn't catch that. Please say that again.";
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Gather input="speech" action="${this.escapeXml(
      actionUrl,
    )}" method="POST" timeout="5" speechTimeout="auto"/></Response>`;
  }

  private buildWebhookUrl(path: string): string {
    const baseUrl = this.config.twilioWebhookBaseUrl?.replace(/\/$/, "");
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private extractToNumber(req: Request): string | null {
    const value = req.body?.To ?? req.body?.to;
    return typeof value === "string" ? value : null;
  }

  private getRequestId(req: Request): string | undefined {
    return typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : undefined;
  }

  private extractCallSid(req: Request): string | null {
    const value = req.body?.CallSid ?? req.body?.callSid;
    return typeof value === "string" ? value : null;
  }

  private extractSpeechResult(req: Request): string | null {
    const value = req.body?.SpeechResult ?? req.body?.speechResult;
    return typeof value === "string" ? value : null;
  }

  private extractConfidence(req: Request): string | null {
    const value = req.body?.Confidence ?? req.body?.confidence;
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : null;
  }

  private normalizeConfidence(value: string | null): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    if (parsed >= 0 && parsed <= 1) {
      return parsed;
    }
    if (parsed > 1 && parsed <= 100) {
      return parsed / 100;
    }
    return undefined;
  }

  private extractFromNumber(req: Request): string | null {
    const value = req.body?.From ?? req.body?.from;
    return typeof value === "string" ? value : null;
  }

  private buildTwiml(message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Hangup/></Response>`;
  }
}
