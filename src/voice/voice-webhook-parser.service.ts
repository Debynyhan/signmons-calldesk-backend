import { Injectable } from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class VoiceWebhookParserService {
  extractToNumber(req: Request): string | null {
    const value = this.getBodyValue(req, "To", "to");
    return typeof value === "string" ? value : null;
  }

  extractFromNumber(req: Request): string | null {
    const value = this.getBodyValue(req, "From", "from");
    return typeof value === "string" ? value : null;
  }

  extractCallSid(req: Request): string | null {
    const value = this.getBodyValue(req, "CallSid", "callSid");
    return typeof value === "string" ? value : null;
  }

  extractSpeechResult(req: Request): string | null {
    const value = this.getBodyValue(req, "SpeechResult", "speechResult");
    return typeof value === "string" ? value : null;
  }

  extractConfidence(req: Request): string | null {
    const value = this.getBodyValue(req, "Confidence", "confidence");
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : null;
  }

  getRequestId(req: Request): string | undefined {
    return typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : undefined;
  }

  private getBodyValue(req: Request, ...keys: string[]): unknown {
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        return body[key];
      }
    }
    return undefined;
  }
}
