import { Injectable } from "@nestjs/common";
import { JobUrgency, PreferredWindowLabel } from "@prisma/client";
import { SanitizationService } from "../sanitization/sanitization.service";
import { CreateJobPayload } from "./interfaces/job-repository.interface";

@Injectable()
export class IssueNormalizerService {
  constructor(private readonly sanitizationService: SanitizationService) {}

  normalizeIssueCategory(
    value: unknown,
  ): CreateJobPayload["issueCategory"] {
    if (typeof value !== "string") return "" as never;
    const normalized = this.sanitizationService
      .normalizeWhitespace(value)
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const mapped: Record<string, CreateJobPayload["issueCategory"]> = {
      heating: "HEATING",
      heat: "HEATING",
      "no heat": "HEATING",
      "heat not working": "HEATING",
      heater: "HEATING",
      furnace: "HEATING",
      "furnace down": "HEATING",
      hvac: "HEATING",
      cooling: "COOLING",
      cool: "COOLING",
      ac: "COOLING",
      "air conditioning": "COOLING",
      "no ac": "COOLING",
      "ac not cooling": "COOLING",
      plumbing: "PLUMBING",
      plumb: "PLUMBING",
      leak: "PLUMBING",
      "pipe leak": "PLUMBING",
      electrical: "ELECTRICAL",
      electric: "ELECTRICAL",
      wiring: "ELECTRICAL",
      general: "GENERAL",
      "general service": "GENERAL",
      "maintenance": "GENERAL",
    };
    return mapped[normalized] ?? ("" as never);
  }

  normalizeUrgency(value: unknown): CreateJobPayload["urgency"] {
    if (typeof value !== "string") return "" as never;
    const normalized = this.sanitizationService
      .normalizeWhitespace(value)
      .toUpperCase();
    if (normalized === "EMERGENCY" || normalized === "URGENT") {
      return "EMERGENCY";
    }
    if (normalized === "STANDARD" || normalized === "NORMAL") {
      return "STANDARD";
    }
    return "" as never;
  }

  normalizePreferredTime(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = this.sanitizationService.normalizeWhitespace(value);
    const upper = normalized.toUpperCase();
    const slots = ["ASAP", "MORNING", "AFTERNOON", "EVENING"];
    if (slots.includes(upper)) {
      return upper;
    }
    const timestamp = Date.parse(normalized);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
    return normalized;
  }

  isPreferredTimeValid(value?: string): boolean {
    if (!value) return true;
    const slots = ["ASAP", "MORNING", "AFTERNOON", "EVENING"];
    if (slots.includes(value)) return true;
    return !Number.isNaN(Date.parse(value));
  }

  mapUrgency(value: string): JobUrgency {
    return value === "EMERGENCY" ? JobUrgency.EMERGENCY : JobUrgency.STANDARD;
  }

  mapPreferredWindow(
    value?: string,
  ): PreferredWindowLabel | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.trim().toUpperCase();
    if (normalized in PreferredWindowLabel) {
      return PreferredWindowLabel[
        normalized as keyof typeof PreferredWindowLabel
      ];
    }
    return undefined;
  }
}
