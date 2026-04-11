import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { AI_PROVIDER } from "./ai.constants";
import type { IAiProvider } from "./interfaces/ai-provider.interface";
import { LoggingService } from "../logging/logging.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import appConfig from "../config/app.config";
import type { AiChatMessageParam } from "./types/ai-completion.types";

@Injectable()
export class AiExtractionService {
  constructor(
    @Inject(AI_PROVIDER) private readonly aiProviderService: IAiProvider,
    private readonly loggingService: LoggingService,
    private readonly sanitizationService: SanitizationService,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  async extractNameCandidate(
    tenantId: string,
    transcript: string,
  ): Promise<string | null> {
    const safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);
    const safeTranscript = this.sanitizationService.sanitizeText(transcript);
    if (!safeTenantId || !safeTranscript) {
      return null;
    }

    const messages: AiChatMessageParam[] = [
      {
        role: "system",
        content:
          'Extract the caller\'s name from the transcript. Return JSON only: {"name": string|null}. If no name is present, return {"name": null}.',
      },
      { role: "user", content: safeTranscript },
    ];

    try {
      const response = await this.aiProviderService.createCompletion({
        messages,
        toolChoice: "none",
        maxTokens: Math.min(this.config.aiMaxTokens ?? 800, 60),
        temperature: this.config.aiExtractionTemperature,
        context: {
          channel: "TEXT",
          lane: "EXTRACTION_NAME",
        },
      });
      const rawContent = response.choices[0]?.message?.content ?? "";
      const content = Array.isArray(rawContent)
        ? rawContent
            .map((part) =>
              typeof part === "string" ? part : (part.text ?? ""),
            )
            .join(" ")
        : rawContent;
      const parsed = this.parseNameJson(content);
      if (!parsed) {
        return null;
      }
      const normalized = this.sanitizationService.sanitizeText(parsed);
      return normalized ? normalized : null;
    } catch {
      this.loggingService.warn(
        {
          event: "ai.name_extraction_failed",
          tenantId: safeTenantId,
        },
        AiExtractionService.name,
      );
      return null;
    }
  }

  async extractAddressCandidate(
    tenantId: string,
    transcript: string,
  ): Promise<{
    address: string | null;
    confidence?: number;
    houseNumber?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null> {
    const safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);
    const safeTranscript = this.sanitizationService.sanitizeText(transcript);
    if (!safeTenantId || !safeTranscript) {
      return null;
    }

    const messages: AiChatMessageParam[] = [
      {
        role: "system",
        content:
          'Extract the service address from the transcript. Return JSON only: {"address": string|null, "houseNumber": string|null, "street": string|null, "city": string|null, "state": string|null, "zip": string|null, "confidence": number|null}. Confidence must be 0-1. If no address is present, return all fields null.',
      },
      { role: "user", content: safeTranscript },
    ];

    try {
      const response = await this.aiProviderService.createCompletion({
        messages,
        toolChoice: "none",
        maxTokens: Math.min(this.config.aiMaxTokens ?? 800, 80),
        temperature: this.config.aiExtractionTemperature,
        context: {
          channel: "TEXT",
          lane: "EXTRACTION_ADDRESS",
        },
      });
      const rawContent = response.choices[0]?.message?.content ?? "";
      const content = Array.isArray(rawContent)
        ? rawContent
            .map((part) =>
              typeof part === "string" ? part : (part.text ?? ""),
            )
            .join(" ")
        : rawContent;
      const parsed = this.parseAddressJson(content);
      if (!parsed) {
        this.loggingService.warn(
          {
            event: "ai.address_extraction_failed",
            tenantId: safeTenantId,
            reason: "invalid_json",
          },
          AiExtractionService.name,
        );
        return null;
      }
      const address = parsed.address
        ? this.sanitizationService.sanitizeText(parsed.address)
        : null;
      const houseNumber = parsed.houseNumber
        ? this.sanitizationService.sanitizeText(parsed.houseNumber)
        : null;
      const street = parsed.street
        ? this.sanitizationService.sanitizeText(parsed.street)
        : null;
      const city = parsed.city
        ? this.sanitizationService.sanitizeText(parsed.city)
        : null;
      const state = parsed.state
        ? this.sanitizationService.sanitizeText(parsed.state)
        : null;
      const zip = parsed.zip
        ? this.sanitizationService.sanitizeText(parsed.zip)
        : null;
      const confidence = this.normalizeConfidence(parsed.confidence);
      return {
        address: address || null,
        ...(typeof confidence === "number" ? { confidence } : {}),
        ...(houseNumber ? { houseNumber } : {}),
        ...(street ? { street } : {}),
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(zip ? { zip } : {}),
      };
    } catch {
      this.loggingService.warn(
        {
          event: "ai.address_extraction_failed",
          tenantId: safeTenantId,
        },
        AiExtractionService.name,
      );
      return null;
    }
  }

  normalizeConfidence(
    value: number | null | undefined,
  ): number | undefined {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return undefined;
    }
    if (value >= 0 && value <= 1) {
      return value;
    }
    if (value > 1 && value <= 100) {
      return value / 100;
    }
    return undefined;
  }

  private parseNameJson(value: string): string | null {
    if (!value) {
      return null;
    }
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    const slice = value.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice) as { name?: unknown };
      return typeof parsed.name === "string" ? parsed.name : null;
    } catch {
      return null;
    }
  }

  private parseAddressJson(value: string): {
    address: string | null;
    confidence?: number | null;
    houseNumber?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null {
    if (!value) {
      return null;
    }
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    const slice = value.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice) as {
        address?: unknown;
        confidence?: unknown;
        houseNumber?: unknown;
        street?: unknown;
        city?: unknown;
        state?: unknown;
        zip?: unknown;
      };
      const address =
        typeof parsed.address === "string" ? parsed.address : null;
      const houseNumber =
        typeof parsed.houseNumber === "string" ? parsed.houseNumber : null;
      const street =
        typeof parsed.street === "string" ? parsed.street : null;
      const city = typeof parsed.city === "string" ? parsed.city : null;
      const state = typeof parsed.state === "string" ? parsed.state : null;
      const zip = typeof parsed.zip === "string" ? parsed.zip : null;
      const confidence =
        typeof parsed.confidence === "number" ||
        typeof parsed.confidence === "string"
          ? Number(parsed.confidence)
          : null;
      return { address, confidence, houseNumber, street, city, state, zip };
    } catch {
      return null;
    }
  }
}
