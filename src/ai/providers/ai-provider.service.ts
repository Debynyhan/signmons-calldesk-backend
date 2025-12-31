import { Inject, Injectable } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
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
      return await this.client.createCompletion({
        model,
        messages: options.messages,
        tools: options.tools,
        tool_choice: options.toolChoice ?? "auto",
      });
    } catch (error) {
      if (this.config.aiProvider === "openai") {
        const shouldFallback =
          model === this.previewModel && this.isPreviewUnavailable(error);
        if (shouldFallback) {
          this.loggingService.warn(
            `Preview model ${this.previewModel} unavailable. Falling back to ${this.defaultModel}.`,
            AiProviderService.name,
          );
          try {
            return await this.client.createCompletion({
              model: this.defaultModel,
              messages: options.messages,
              tools: options.tools,
              tool_choice: options.toolChoice ?? "auto",
            });
          } catch (fallbackError) {
            this.handleProviderError(fallbackError, options, this.defaultModel);
          }
        }
      }
      this.handleProviderError(error, options, model);
    }
  }

  private selectModel(): string {
    if (this.config.aiProvider === "vertex") {
      return this.config.vertexModel;
    }
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
}
