import { jest } from "@jest/globals";
import { AiExtractionService } from "../ai-extraction.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import { LoggingService } from "../../logging/logging.service";
import type { IAiProvider } from "../interfaces/ai-provider.interface";
import appConfig from "../../config/app.config";

describe("AiExtractionService", () => {
  const tenantId = "tenant-abc";

  let aiProvider: jest.Mocked<IAiProvider>;
  let loggingService: jest.Mocked<LoggingService>;
  let sanitizationService: SanitizationService;
  let config: ReturnType<typeof appConfig>;
  let service: AiExtractionService;

  beforeEach(() => {
    aiProvider = {
      createCompletion: jest.fn(),
    } as unknown as jest.Mocked<IAiProvider>;

    loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as jest.Mocked<LoggingService>;

    sanitizationService = new SanitizationService();

    config = {
      aiMaxTokens: 800,
      aiExtractionTemperature: 0,
    } as ReturnType<typeof appConfig>;

    service = new AiExtractionService(
      aiProvider,
      loggingService,
      sanitizationService,
      config,
    );
  });

  describe("extractNameCandidate", () => {
    it("returns extracted name from valid JSON", async () => {
      aiProvider.createCompletion.mockResolvedValue({
        choices: [
          { message: { role: "assistant", content: '{"name":"Alice"}' } },
        ],
      } as never);

      const result = await service.extractNameCandidate(
        tenantId,
        "Hi my name is Alice",
      );

      expect(result).toBe("Alice");
    });

    it("returns null when JSON has null name", async () => {
      aiProvider.createCompletion.mockResolvedValue({
        choices: [
          { message: { role: "assistant", content: '{"name":null}' } },
        ],
      } as never);

      const result = await service.extractNameCandidate(tenantId, "No name");

      expect(result).toBeNull();
    });

    it("returns null when response is not valid JSON", async () => {
      aiProvider.createCompletion.mockResolvedValue({
        choices: [
          { message: { role: "assistant", content: "not-json" } },
        ],
      } as never);

      const result = await service.extractNameCandidate(tenantId, "hi there");

      expect(result).toBeNull();
    });

    it("returns null and warns on provider error", async () => {
      aiProvider.createCompletion.mockRejectedValue(new Error("timeout"));

      const result = await service.extractNameCandidate(tenantId, "My name is Bob");

      expect(result).toBeNull();
      expect(loggingService.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "ai.name_extraction_failed", tenantId }),
        AiExtractionService.name,
      );
    });

    it("returns null for empty tenantId", async () => {
      const result = await service.extractNameCandidate("", "My name is Bob");
      expect(result).toBeNull();
      expect(aiProvider.createCompletion).not.toHaveBeenCalled();
    });

    it("uses EXTRACTION_NAME lane in request context", async () => {
      aiProvider.createCompletion.mockResolvedValue({
        choices: [
          { message: { role: "assistant", content: '{"name":"Dave"}' } },
        ],
      } as never);

      await service.extractNameCandidate(tenantId, "I am Dave");

      const request = aiProvider.createCompletion.mock.calls[0]?.[0] as {
        context?: { channel?: string; lane?: string };
      };
      expect(request.context).toEqual({ channel: "TEXT", lane: "EXTRACTION_NAME" });
    });
  });

  describe("extractAddressCandidate", () => {
    it("returns extracted address from valid JSON", async () => {
      aiProvider.createCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              role: "assistant",
              content: '{"address":"123 Main St","confidence":0.9}',
            },
          },
        ],
      } as never);

      const result = await service.extractAddressCandidate(
        tenantId,
        "My address is 123 Main St",
      );

      expect(result).toEqual({ address: "123 Main St", confidence: 0.9 });
    });

    it("normalizes confidence from 0–100 scale to 0–1", async () => {
      aiProvider.createCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              role: "assistant",
              content: '{"address":"456 Elm Ave","confidence":85}',
            },
          },
        ],
      } as never);

      const result = await service.extractAddressCandidate(tenantId, "456 Elm Ave");

      expect(result).toEqual({ address: "456 Elm Ave", confidence: 0.85 });
    });

    it("returns null and warns when JSON is invalid", async () => {
      aiProvider.createCompletion.mockResolvedValue({
        choices: [{ message: { role: "assistant", content: "no json here" } }],
      } as never);

      const result = await service.extractAddressCandidate(tenantId, "some address");

      expect(result).toBeNull();
      expect(loggingService.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "ai.address_extraction_failed",
          tenantId,
          reason: "invalid_json",
        }),
        AiExtractionService.name,
      );
    });

    it("returns null and warns on provider error", async () => {
      aiProvider.createCompletion.mockRejectedValue(new Error("network error"));

      const result = await service.extractAddressCandidate(tenantId, "123 Oak St");

      expect(result).toBeNull();
      expect(loggingService.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "ai.address_extraction_failed", tenantId }),
        AiExtractionService.name,
      );
    });

    it("returns null for empty transcript", async () => {
      const result = await service.extractAddressCandidate(tenantId, "");
      expect(result).toBeNull();
      expect(aiProvider.createCompletion).not.toHaveBeenCalled();
    });

    it("uses EXTRACTION_ADDRESS lane in request context", async () => {
      aiProvider.createCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              role: "assistant",
              content: '{"address":"789 Pine Rd","confidence":0.7}',
            },
          },
        ],
      } as never);

      await service.extractAddressCandidate(tenantId, "789 Pine Rd");

      const request = aiProvider.createCompletion.mock.calls[0]?.[0] as {
        context?: { channel?: string; lane?: string };
      };
      expect(request.context).toEqual({ channel: "TEXT", lane: "EXTRACTION_ADDRESS" });
    });
  });

  describe("normalizeConfidence", () => {
    it("returns value as-is when in 0–1 range", () => {
      expect(service.normalizeConfidence(0.75)).toBe(0.75);
    });

    it("divides by 100 when value is in 1–100 range", () => {
      expect(service.normalizeConfidence(75)).toBe(0.75);
    });

    it("returns undefined for NaN", () => {
      expect(service.normalizeConfidence(NaN)).toBeUndefined();
    });

    it("returns undefined for null", () => {
      expect(service.normalizeConfidence(null)).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
      expect(service.normalizeConfidence(undefined)).toBeUndefined();
    });

    it("returns undefined for values > 100", () => {
      expect(service.normalizeConfidence(101)).toBeUndefined();
    });

    it("returns 0 for exactly 0", () => {
      expect(service.normalizeConfidence(0)).toBe(0);
    });
  });
});
