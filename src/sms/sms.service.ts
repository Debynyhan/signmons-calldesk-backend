import { Inject, Injectable } from "@nestjs/common";
import { Twilio } from "twilio";
import appConfig, { type AppConfig } from "../config/app.config";
import { LoggingService } from "../logging/logging.service";
import { SanitizationService } from "../sanitization/sanitization.service";

type SendSmsParams = {
  to: string;
  from?: string;
  body: string;
  tenantId?: string;
  conversationId?: string;
};

@Injectable()
export class SmsService {
  private twilioClient: Twilio | null = null;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly loggingService: LoggingService,
    private readonly sanitizationService: SanitizationService,
  ) {}

  async sendMessage(params: SendSmsParams): Promise<string | null> {
    const to = this.sanitizationService.normalizePhoneE164(params.to);
    const fromCandidate = params.from
      ? this.sanitizationService.normalizePhoneE164(params.from)
      : "";
    const fromConfig = this.sanitizationService.normalizePhoneE164(
      this.config.twilioPhoneNumber,
    );
    const from = fromCandidate || fromConfig;
    const body = this.sanitizationService.sanitizeText(params.body);

    if (!to || !from || !body) {
      this.loggingService.warn(
        {
          event: "sms.send_invalid_payload",
          to,
          from,
          hasBody: Boolean(body),
          tenantId: params.tenantId ?? null,
          conversationId: params.conversationId ?? null,
        },
        SmsService.name,
      );
      return null;
    }

    const client = this.getTwilioClient();
    if (!client) {
      this.loggingService.warn(
        {
          event: "sms.send_missing_twilio_config",
          tenantId: params.tenantId ?? null,
          conversationId: params.conversationId ?? null,
        },
        SmsService.name,
      );
      return null;
    }

    try {
      const message = await client.messages.create({
        to,
        from,
        body,
      });
      this.loggingService.log(
        {
          event: "sms.sent",
          messageSid: message.sid,
          to,
          from,
          tenantId: params.tenantId ?? null,
          conversationId: params.conversationId ?? null,
        },
        SmsService.name,
      );
      return message.sid ?? null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "send_failed";
      this.loggingService.warn(
        {
          event: "sms.send_failed",
          reason,
          to,
          from,
          tenantId: params.tenantId ?? null,
          conversationId: params.conversationId ?? null,
        },
        SmsService.name,
      );
      return null;
    }
  }

  private getTwilioClient(): Twilio | null {
    if (!this.config.twilioAccountSid || !this.config.twilioAuthToken) {
      return null;
    }
    if (!this.twilioClient) {
      this.twilioClient = new Twilio(
        this.config.twilioAccountSid,
        this.config.twilioAuthToken,
      );
    }
    return this.twilioClient;
  }
}
