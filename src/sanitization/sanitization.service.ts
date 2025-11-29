import { Injectable } from "@nestjs/common";

const CONTROL_CHAR_PATTERN = "[\\u0000-\\u001F\\u007F]";
const LOGGING_CONTROL_CHAR_PATTERN = "[\\u0000-\\u001F]";
const CONTROL_CHAR_REGEX = new RegExp(CONTROL_CHAR_PATTERN, "g");
const LOGGING_CONTROL_CHAR_REGEX = new RegExp(
  LOGGING_CONTROL_CHAR_PATTERN,
  "g",
);
const HTML_TAG_REGEX = /<[^>]*>/g;

@Injectable()
export class SanitizationService {
  sanitizeText(value: string): string {
    if (typeof value !== "string") {
      return "";
    }

    const stripped = value
      .replace(CONTROL_CHAR_REGEX, "")
      .replace(HTML_TAG_REGEX, "");
    return this.normalizeWhitespace(stripped);
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

    return value.replace(LOGGING_CONTROL_CHAR_REGEX, "");
  }
}
