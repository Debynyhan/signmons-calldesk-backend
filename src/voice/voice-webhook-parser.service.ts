import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { TwilioVoiceWebhookDto } from "./dto/twilio-voice-webhook.dto";

@Injectable()
export class VoiceWebhookParserService {
  extractToNumber(body: TwilioVoiceWebhookDto): string | null {
    return typeof body.To === "string" ? body.To : null;
  }

  extractFromNumber(body: TwilioVoiceWebhookDto): string | null {
    return typeof body.From === "string" ? body.From : null;
  }

  extractCallSid(body: TwilioVoiceWebhookDto): string | null {
    return typeof body.CallSid === "string" ? body.CallSid : null;
  }

  extractSpeechResult(body: TwilioVoiceWebhookDto): string | null {
    return typeof body.SpeechResult === "string" ? body.SpeechResult : null;
  }

  extractConfidence(body: TwilioVoiceWebhookDto): string | null {
    if (typeof body.Confidence === "string" || typeof body.Confidence === "number") {
      return String(body.Confidence);
    }
    return null;
  }

  getRequestId(req: Request): string | undefined {
    return typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : undefined;
  }
}
