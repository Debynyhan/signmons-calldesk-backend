import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../../config/app.config";
import { AI_COMPLETION_PROVIDER } from "../ai.constants";
import type { CompletionRequest, IAiProviderClient } from "./ai-provider.interface";
import type {
  CompletionRequestOptions,
  IAiProvider,
} from "../interfaces/ai-provider.interface";
import type { AiCompletionResponse } from "../types/ai-completion.types";
import { AiErrorHandler } from "../ai-error.handler";
import { LoggingService } from "../../logging/logging.service";
import { getRequestContext } from "../../common/context/request-context";

@Injectable()
export class AiProviderService implements IAiProvider {
  constructor(
    @Inject(AI_COMPLETION_PROVIDER) private readonly client: IAiProviderClient,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly errorHandler: AiErrorHandler,
    private readonly loggingService: LoggingService,
  ) {}

  async createCompletion(
    options: CompletionRequestOptions,
  ): Promise<AiCompletionResponse> {
    const model = this.selectModel(options);
    try {
      return await this.requestWithRetry(model, options);
    } catch (error) {
      const shouldFallback =
        model === this.getPreviewModel() && this.isPreviewUnavailable(error);
      if (shouldFallback) {
        this.logAiEvent("ai.preview_fallback", {
          model: this.getPreviewModel(),
          reason: "preview_unavailable",
          fallbackModel: this.getDefaultModel(),
        });
        try {
          return await this.requestWithRetry(this.getDefaultModel(), options);
        } catch (fallbackError) {
          this.handleProviderError(fallbackError, options, this.getDefaultModel());
        }
      }
      this.handleProviderError(error, options, model);
    }
  }

  private selectModel(options: CompletionRequestOptions): string {
    const laneModel = this.selectLaneModel(options);
    if (laneModel) {
      return laneModel;
    }

    const channelModel = this.selectChannelModel(options);
    if (channelModel) {
      return channelModel;
    }

    return this.config.enablePreviewModel
      ? this.getPreviewModel()
      : this.getDefaultModel();
  }

  private selectLaneModel(options: CompletionRequestOptions): string | null {
    switch (options.context?.lane) {
      case "TRIAGE_ROUTER":
        return this.normalizeConfiguredModel(this.config.aiRouterModel);
      case "TRIAGE_BOOKING":
        return this.normalizeConfiguredModel(this.config.aiBookingModel);
      case "TRIAGE_FAQ":
        return this.normalizeConfiguredModel(this.config.aiFaqModel);
      case "EXTRACTION_NAME":
      case "EXTRACTION_ADDRESS":
        return this.normalizeConfiguredModel(this.config.aiExtractionModel);
      default:
        return null;
    }
  }

  private selectChannelModel(options: CompletionRequestOptions): string | null {
    switch (options.context?.channel) {
      case "TEXT":
        return this.normalizeConfiguredModel(this.config.aiTextModel);
      case "VOICE":
        return this.normalizeConfiguredModel(this.config.aiVoiceModel);
      default:
        return null;
    }
  }

  private getDefaultModel(): string {
    return this.normalizeConfiguredModel(this.config.aiDefaultModel) ?? "gpt-4o-mini";
  }

  private getPreviewModel(): string {
    return (
      this.normalizeConfiguredModel(this.config.aiPreviewModel) ?? "gpt-5.1-codex"
    );
  }

  private normalizeConfiguredModel(value?: string | null): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private isPreviewUnavailable(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const maybeMessage =
      "message" in error ? (error as { message?: unknown }).message : undefined;
    return (
      typeof maybeMessage === "string" && maybeMessage.includes("not found")
    );
  }

  private handleProviderError(
    error: unknown,
    options: CompletionRequestOptions,
    model: string,
  ): never {
    this.errorHandler.handle(error, {
      stage: "completion",
      metadata: {
        model,
        messageCount: options.messages.length,
        toolCount: options.tools?.length ?? 0,
      },
    });
  }

  private async requestWithRetry(
    model: string,
    options: CompletionRequestOptions,
  ): Promise<AiCompletionResponse> {
    const maxRetries = Math.max(0, this.config.aiMaxRetries ?? 0);
    let attempt = 0;
    while (true) {
      try {
        return await this.requestWithTimeout(model, options);
      } catch (error) {
        if (attempt >= maxRetries) {
          this.logAiEvent("ai.retry_exhausted", {
            model,
            reason: "provider_failure",
            attempts: attempt + 1,
            limit: maxRetries,
          });
          throw error;
        }
        attempt += 1;
        this.loggingService.warn(
          {
            event: "ai_budget_triggered",
            budget: "AI_MAX_RETRIES",
            limit: maxRetries,
            attempt,
          },
          AiProviderService.name,
        );
      }
    }
  }

  private async requestWithTimeout(
    model: string,
    options: CompletionRequestOptions,
  ): Promise<AiCompletionResponse> {
    const timeoutMs = Math.max(1000, this.config.aiTimeoutMs ?? 15000);
    const requestPayload: CompletionRequest = { model, messages: options.messages };
    if (typeof options.maxTokens === "number") {
      requestPayload.maxTokens = options.maxTokens;
    }
    if (typeof options.temperature === "number") {
      requestPayload.temperature = options.temperature;
    }
    if (options.tools && options.tools.length > 0) {
      requestPayload.tools = options.tools;
      requestPayload.toolChoice = options.toolChoice ?? "auto";
    }
    const request = this.client.createCompletion(requestPayload);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.loggingService.warn(
          {
            event: "ai_budget_triggered",
            budget: "AI_TIMEOUT_MS",
            limit: timeoutMs,
          },
          AiProviderService.name,
        );
        reject(new Error("AI request timed out."));
      }, timeoutMs);
    });

    try {
      return await Promise.race([request, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private logAiEvent(
    event: "ai.preview_fallback" | "ai.retry_exhausted",
    details: {
      model?: string;
      reason: string;
      fallbackModel?: string;
      attempts?: number;
      limit?: number;
    },
  ) {
    const context = getRequestContext();
    const payload: Record<string, unknown> = {
      event,
      tenantId: context?.tenantId,
      requestId: context?.requestId,
      model: details.model,
      reason: details.reason,
    };

    if (context?.callSid) {
      payload.callSid = context.callSid;
    }

    if (context?.conversationId) {
      payload.conversationId = context.conversationId;
    }

    if (details.fallbackModel) {
      payload.fallbackModel = details.fallbackModel;
    }

    if (typeof details.attempts === "number") {
      payload.attempts = details.attempts;
    }

    if (typeof details.limit === "number") {
      payload.limit = details.limit;
    }

    this.loggingService.warn(payload, AiProviderService.name);
  }
}
