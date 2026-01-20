import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type OpenAI from "openai";
import appConfig from "../../config/app.config";
import { AI_COMPLETION_PROVIDER } from "../ai.constants";
import type { IAiProviderClient } from "./ai-provider.interface";
import type {
  CompletionRequestOptions,
  IAiProvider,
} from "../interfaces/ai-provider.interface";
import { AiErrorHandler } from "../ai-error.handler";
import { LoggingService } from "../../logging/logging.service";
import { getRequestContext } from "../../common/context/request-context";

@Injectable()
export class AiProviderService implements IAiProvider {
  private readonly defaultModel = "gpt-4o-mini";
  private readonly previewModel = "gpt-5.1-codex";

  constructor(
    @Inject(AI_COMPLETION_PROVIDER) private readonly client: IAiProviderClient,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly errorHandler: AiErrorHandler,
    private readonly loggingService: LoggingService,
  ) {}

  async createCompletion(
    options: CompletionRequestOptions,
  ): Promise<OpenAI.ChatCompletion> {
    const model = this.selectModel();
    try {
      return await this.requestWithRetry(model, options);
    } catch (error) {
      const shouldFallback =
        model === this.previewModel && this.isPreviewUnavailable(error);
      if (shouldFallback) {
        this.logAiEvent("ai.preview_fallback", {
          model: this.previewModel,
          reason: "preview_unavailable",
          fallbackModel: this.defaultModel,
        });
        try {
          return await this.requestWithRetry(this.defaultModel, options);
        } catch (fallbackError) {
          this.handleProviderError(fallbackError, options, this.defaultModel);
        }
      }
      this.handleProviderError(error, options, model);
    }
  }

  private selectModel(): string {
    return this.config.enablePreviewModel
      ? this.previewModel
      : this.defaultModel;
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
  ): Promise<OpenAI.ChatCompletion> {
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
  ): Promise<OpenAI.ChatCompletion> {
    const timeoutMs = Math.max(1000, this.config.aiTimeoutMs ?? 15000);
    const request = this.client.createCompletion({
      model,
      messages: options.messages,
      tools: options.tools,
      tool_choice: options.toolChoice ?? "auto",
      max_tokens: options.maxTokens,
    });

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
