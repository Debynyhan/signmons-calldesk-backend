import { BadRequestException } from "@nestjs/common";
import { CreateJobPayloadValidatorService } from "../create-job-payload-validator.service";
import { IssueNormalizerService } from "../issue-normalizer.service";
import { SanitizationService } from "../../sanitization/sanitization.service";

const buildService = () => {
  const sanitizationService = new SanitizationService();
  return new CreateJobPayloadValidatorService(
    sanitizationService,
    new IssueNormalizerService(sanitizationService),
  );
};

const validRawArgs = JSON.stringify({
  customerName: "Alice",
  phone: "1234567890",
  issueCategory: "HEATING",
  urgency: "STANDARD",
});

describe("CreateJobPayloadValidatorService", () => {
  describe("parseAndNormalize — happy path", () => {
    it("returns normalized payload for a valid input", () => {
      const svc = buildService();
      const { payload } = svc.parseAndNormalize(validRawArgs);

      expect(payload.customerName).toBe("Alice");
      expect(payload.phone).toBe("+11234567890");
      expect(payload.issueCategory).toBe("HEATING");
      expect(payload.urgency).toBe("STANDARD");
    });

    it("returns mappedUrgency as a JobUrgency enum value", () => {
      const svc = buildService();
      const { mappedUrgency } = svc.parseAndNormalize(validRawArgs);
      expect(mappedUrgency).toBe("STANDARD");
    });

    it("returns mappedPreferredWindow as undefined when not provided", () => {
      const svc = buildService();
      const { mappedPreferredWindow } = svc.parseAndNormalize(validRawArgs);
      expect(mappedPreferredWindow).toBeUndefined();
    });

    it("returns mappedPreferredWindow when preferredTime is valid", () => {
      const svc = buildService();
      const { mappedPreferredWindow } = svc.parseAndNormalize(
        JSON.stringify({
          customerName: "Alice",
          phone: "1234567890",
          issueCategory: "HEATING",
          urgency: "STANDARD",
          preferredTime: "morning",
        }),
      );
      expect(mappedPreferredWindow).toBeDefined();
    });

    it("normalizes issueCategory synonyms to canonical values", () => {
      const svc = buildService();
      const { payload } = svc.parseAndNormalize(
        JSON.stringify({
          customerName: "Alice",
          phone: "1234567890",
          issueCategory: "No heat",
          urgency: "STANDARD",
        }),
      );
      expect(payload.issueCategory).toBe("HEATING");
    });

    it("normalizes EMERGENCY urgency alias", () => {
      const svc = buildService();
      const { payload, mappedUrgency } = svc.parseAndNormalize(
        JSON.stringify({
          customerName: "Alice",
          phone: "1234567890",
          issueCategory: "HEATING",
          urgency: "emergency",
        }),
      );
      expect(payload.urgency).toBe("EMERGENCY");
      expect(mappedUrgency).toBe("EMERGENCY");
    });

    it("includes audit object in the result", () => {
      const svc = buildService();
      const { audit } = svc.parseAndNormalize(validRawArgs);
      expect(audit).toEqual(
        expect.objectContaining({
          rawArgs: validRawArgs,
          normalizedArgs: expect.objectContaining({ customerName: "Alice" }),
        }),
      );
    });
  });

  describe("parseAndNormalize — validation errors", () => {
    it("throws BadRequestException when rawArgs is missing", () => {
      const svc = buildService();
      expect(() => svc.parseAndNormalize(undefined)).toThrow(BadRequestException);
    });

    it("throws BadRequestException when rawArgs is blank", () => {
      const svc = buildService();
      expect(() => svc.parseAndNormalize("   ")).toThrow(BadRequestException);
    });

    it("throws BadRequestException when JSON is invalid", () => {
      const svc = buildService();
      expect(() => svc.parseAndNormalize("{not valid json")).toThrow(BadRequestException);
    });

    it("throws BadRequestException when payload is not an object", () => {
      const svc = buildService();
      expect(() => svc.parseAndNormalize('"just a string"')).toThrow(BadRequestException);
    });

    it("throws BadRequestException when required fields are missing", () => {
      const svc = buildService();
      expect(() =>
        svc.parseAndNormalize(JSON.stringify({ urgency: "STANDARD" })),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException when phone is invalid", () => {
      const svc = buildService();
      expect(() =>
        svc.parseAndNormalize(
          JSON.stringify({
            customerName: "Alice",
            phone: "abc",
            issueCategory: "HEATING",
            urgency: "STANDARD",
          }),
        ),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException when issueCategory is unknown", () => {
      const svc = buildService();
      expect(() =>
        svc.parseAndNormalize(
          JSON.stringify({
            customerName: "Alice",
            phone: "1234567890",
            issueCategory: "GARBAGE",
            urgency: "STANDARD",
          }),
        ),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException when unexpected fields are present", () => {
      const svc = buildService();
      expect(() =>
        svc.parseAndNormalize(
          JSON.stringify({
            customerName: "Alice",
            phone: "1234567890",
            issueCategory: "HEATING",
            urgency: "STANDARD",
            extraField: "nope",
          }),
        ),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException when preferredTime is invalid", () => {
      const svc = buildService();
      expect(() =>
        svc.parseAndNormalize(
          JSON.stringify({
            customerName: "Alice",
            phone: "1234567890",
            issueCategory: "HEATING",
            urgency: "STANDARD",
            preferredTime: "sometime next week",
          }),
        ),
      ).toThrow(BadRequestException);
    });
  });
});
