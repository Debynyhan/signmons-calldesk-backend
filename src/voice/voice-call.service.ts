import { Inject, Injectable } from "@nestjs/common";
import { Twilio } from "twilio";
import appConfig, { type AppConfig } from "../config/app.config";
import { LoggingService } from "../logging/logging.service";

@Injectable()
export class VoiceCallService {
  private twilioClient: Twilio | null = null;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly loggingService: LoggingService,
  ) {}

  async updateCallTwiml(callSid: string, twiml: string): Promise<boolean> {
    const client = this.getTwilioClient();
    if (!client) {
      this.loggingService.warn(
        { event: "voice.call_update_skipped", callSid },
        VoiceCallService.name,
      );
      return false;
    }

    try {
      await client.calls(callSid).update({ twiml });
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.loggingService.warn(
        { event: "voice.call_update_failed", callSid, reason },
        VoiceCallService.name,
      );
      return false;
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
