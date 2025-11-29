import { Injectable } from "@nestjs/common";

@Injectable()
export class SanitizationService {
  sanitizeText(value: string): string {
    if (typeof value !== "string") {
      return "";
    }

    return this.normalizeWhitespace(
      value
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .replace(/<[^>]*>/g, "")
    );
  }

  sanitizeIdentifier(value: string): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.replace(/[^A-Za-z0-9_-]/g, "").trim();
  }

  normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  escapeForLogging(value: string): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.replace(/[\u0000-\u001F]/g, "");
  }
}
