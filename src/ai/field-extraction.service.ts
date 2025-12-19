import { Inject, Injectable } from "@nestjs/common";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { AI_PROVIDER } from "./ai.constants";
import type { IAiProvider } from "./interfaces/ai-provider.interface";
import { LoggingService } from "../logging/logging.service";
import type {
  BookingFields,
  CallDeskCategory,
  CallDeskUrgency,
} from "./session-state/call-desk-state";

export interface ExtractedFieldPayload {
  fields: Partial<BookingFields>;
  category?: CallDeskCategory;
  urgency?: CallDeskUrgency;
}

const EXTRACTION_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "extract_fields",
    description:
      "Extract caller booking fields from a single user message.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        address: { type: ["string", "null"] },
        issue: { type: ["string", "null"] },
        preferred_window: { type: ["string", "null"] },
        category: { type: ["string", "null"] },
        urgency: { type: ["string", "null"] },
      },
    },
  },
};

const EXTRACTION_SYSTEM_PROMPT =
  "You are a strict extraction engine. Return ONLY a JSON object " +
  'with keys: name, phone, address, issue, preferred_window, category, urgency. ' +
  "Use null when unknown. Do not guess, do not add commentary.";

const CATEGORY_MAP: Record<string, CallDeskCategory> = {
  HEATING: "HEATING",
  COOLING: "COOLING",
  PLUMBING: "PLUMBING",
  ELECTRICAL: "ELECTRICAL",
  DRAINS: "DRAINS",
  GENERAL_HANDYMAN_CONSTRUCTION: "GENERAL_HANDYMAN_CONSTRUCTION",
  GENERAL_HANDYMAN: "GENERAL_HANDYMAN_CONSTRUCTION",
  CONSTRUCTION: "GENERAL_HANDYMAN_CONSTRUCTION",
  HANDYMAN: "GENERAL_HANDYMAN_CONSTRUCTION",
  GENERAL: "GENERAL_HANDYMAN_CONSTRUCTION",
};

const URGENCY_MAP: Record<string, CallDeskUrgency> = {
  EMERGENCY: "EMERGENCY",
  HIGH_PRIORITY: "HIGH_PRIORITY",
  STANDARD: "STANDARD",
  URGENT: "EMERGENCY",
  ASAP: "EMERGENCY",
};

@Injectable()
export class FieldExtractionService {
  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: IAiProvider,
    private readonly loggingService: LoggingService,
  ) {}

  async extractFields(message: string): Promise<ExtractedFieldPayload> {
    const response = await this.aiProvider.createCompletion({
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      tools: [EXTRACTION_TOOL],
      toolChoice: {
        type: "function",
        function: { name: "extract_fields" },
      },
    });

    const choice = response.choices[0];
    const toolCall = choice?.message?.tool_calls?.[0];
    const rawArgs = toolCall?.function?.arguments;
    const content = choice?.message?.content as unknown;
    const rawContent =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? (content as unknown[])
              .map((part) =>
                typeof part === "string"
                  ? part
                  : ((part as { text?: string })?.text ?? ""),
              )
              .join(" ")
          : "";

    const payload = this.parsePayload(rawArgs ?? rawContent);
    if (!payload) {
      return { fields: {} };
    }

    const fields: Partial<BookingFields> = {};
    const name = this.cleanString(payload.name);
    if (name) fields.name = name;
    const phone = this.cleanString(payload.phone);
    if (phone) fields.phone = phone;
    const address = this.cleanString(payload.address);
    if (address) fields.address = address;
    const issue = this.cleanString(payload.issue, 240);
    if (issue) fields.issue = issue;
    const preferred = this.cleanString(payload.preferred_window);
    if (preferred) fields.preferred_window = preferred;

    return {
      fields,
      category: this.normalizeCategory(payload.category),
      urgency: this.normalizeUrgency(payload.urgency),
    };
  }

  private parsePayload(raw: string | undefined): Record<string, unknown> | null {
    if (!raw) {
      return null;
    }
    const trimmed = raw.trim();
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < jsonStart) {
      this.loggingService.warn(
        "Field extraction returned non-JSON payload.",
        FieldExtractionService.name,
      );
      return null;
    }
    try {
      return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    } catch (error) {
      this.loggingService.warn(
        `Failed to parse field extraction payload: ${
          error instanceof Error ? error.message : "unknown"
        }`,
        FieldExtractionService.name,
      );
      return null;
    }
  }

  private cleanString(
    value: unknown,
    maxLength = 180,
  ): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const cleaned = value.trim();
    if (!cleaned) return undefined;
    if (/^(unknown|n\/a|na|null|none)$/i.test(cleaned)) {
      return undefined;
    }
    return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
  }

  private normalizeCategory(
    value: unknown,
  ): CallDeskCategory | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value
      .toUpperCase()
      .replace(/[\/\s-]+/g, "_")
      .replace(/__+/g, "_");
    return CATEGORY_MAP[normalized];
  }

  private normalizeUrgency(value: unknown): CallDeskUrgency | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value
      .toUpperCase()
      .replace(/[\/\s-]+/g, "_")
      .replace(/__+/g, "_");
    return URGENCY_MAP[normalized];
  }
}
