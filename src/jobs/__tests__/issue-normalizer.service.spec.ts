import { IssueNormalizerService } from "../issue-normalizer.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import { JobUrgency, PreferredWindowLabel } from "@prisma/client";

describe("IssueNormalizerService", () => {
  const service = new IssueNormalizerService(new SanitizationService());

  describe("normalizeIssueCategory", () => {
    it("maps 'heating' to HEATING", () => {
      expect(service.normalizeIssueCategory("heating")).toBe("HEATING");
    });

    it("maps 'no heat' to HEATING", () => {
      expect(service.normalizeIssueCategory("no heat")).toBe("HEATING");
    });

    it("maps 'furnace' to HEATING", () => {
      expect(service.normalizeIssueCategory("furnace")).toBe("HEATING");
    });

    it("maps 'ac' to COOLING", () => {
      expect(service.normalizeIssueCategory("ac")).toBe("COOLING");
    });

    it("maps 'air conditioning' to COOLING", () => {
      expect(service.normalizeIssueCategory("air conditioning")).toBe("COOLING");
    });

    it("maps 'leak' to PLUMBING", () => {
      expect(service.normalizeIssueCategory("leak")).toBe("PLUMBING");
    });

    it("maps 'electrical' to ELECTRICAL", () => {
      expect(service.normalizeIssueCategory("electrical")).toBe("ELECTRICAL");
    });

    it("maps 'maintenance' to GENERAL", () => {
      expect(service.normalizeIssueCategory("maintenance")).toBe("GENERAL");
    });

    it("normalizes case and extra whitespace", () => {
      expect(service.normalizeIssueCategory("  FURNACE DOWN  ")).toBe("HEATING");
    });

    it("normalizes multi-space synonym 'ac not cooling'", () => {
      expect(service.normalizeIssueCategory("  aC   not   COOLING ")).toBe("COOLING");
    });

    it("returns empty string for unknown category", () => {
      expect(service.normalizeIssueCategory("garbage")).toBe("");
    });

    it("returns empty string for non-string input", () => {
      expect(service.normalizeIssueCategory(123 as unknown as string)).toBe("");
    });
  });

  describe("normalizeUrgency", () => {
    it("maps EMERGENCY to EMERGENCY", () => {
      expect(service.normalizeUrgency("EMERGENCY")).toBe("EMERGENCY");
    });

    it("maps URGENT to EMERGENCY", () => {
      expect(service.normalizeUrgency("URGENT")).toBe("EMERGENCY");
    });

    it("maps STANDARD to STANDARD", () => {
      expect(service.normalizeUrgency("STANDARD")).toBe("STANDARD");
    });

    it("maps NORMAL to STANDARD", () => {
      expect(service.normalizeUrgency("NORMAL")).toBe("STANDARD");
    });

    it("returns empty string for unknown urgency", () => {
      expect(service.normalizeUrgency("soon")).toBe("");
    });
  });

  describe("normalizePreferredTime", () => {
    it("returns ASAP slot unchanged", () => {
      expect(service.normalizePreferredTime("asap")).toBe("ASAP");
    });

    it("returns MORNING slot unchanged", () => {
      expect(service.normalizePreferredTime("morning")).toBe("MORNING");
    });

    it("returns AFTERNOON slot unchanged", () => {
      expect(service.normalizePreferredTime("afternoon")).toBe("AFTERNOON");
    });

    it("returns EVENING slot unchanged", () => {
      expect(service.normalizePreferredTime("evening")).toBe("EVENING");
    });

    it("parses a valid ISO timestamp", () => {
      const result = service.normalizePreferredTime("2026-06-01T10:00:00.000Z");
      expect(result).toBe("2026-06-01T10:00:00.000Z");
    });

    it("returns the raw value for unrecognized strings", () => {
      expect(service.normalizePreferredTime("sometime next week")).toBe("sometime next week");
    });

    it("returns undefined for non-string input", () => {
      expect(service.normalizePreferredTime(null as unknown as string)).toBeUndefined();
    });
  });

  describe("isPreferredTimeValid", () => {
    it("returns true when value is undefined", () => {
      expect(service.isPreferredTimeValid(undefined)).toBe(true);
    });

    it("returns true for ASAP slot", () => {
      expect(service.isPreferredTimeValid("ASAP")).toBe(true);
    });

    it("returns true for a valid ISO date", () => {
      expect(service.isPreferredTimeValid("2026-06-01T10:00:00.000Z")).toBe(true);
    });

    it("returns false for an unrecognized string", () => {
      expect(service.isPreferredTimeValid("sometime next week")).toBe(false);
    });
  });

  describe("mapUrgency", () => {
    it("maps EMERGENCY string to JobUrgency.EMERGENCY", () => {
      expect(service.mapUrgency("EMERGENCY")).toBe(JobUrgency.EMERGENCY);
    });

    it("maps anything else to JobUrgency.STANDARD", () => {
      expect(service.mapUrgency("STANDARD")).toBe(JobUrgency.STANDARD);
    });
  });

  describe("mapPreferredWindow", () => {
    it("returns undefined when value is undefined", () => {
      expect(service.mapPreferredWindow(undefined)).toBeUndefined();
    });

    it("maps MORNING to PreferredWindowLabel.MORNING", () => {
      expect(service.mapPreferredWindow("MORNING")).toBe(PreferredWindowLabel.MORNING);
    });

    it("maps AFTERNOON to PreferredWindowLabel.AFTERNOON", () => {
      expect(service.mapPreferredWindow("AFTERNOON")).toBe(PreferredWindowLabel.AFTERNOON);
    });

    it("returns undefined for an unrecognized window", () => {
      expect(service.mapPreferredWindow("tonight")).toBeUndefined();
    });
  });
});
