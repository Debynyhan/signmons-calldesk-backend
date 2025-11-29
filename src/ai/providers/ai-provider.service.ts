import { Inject, Injectable } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import appConfig from "../../config/app.config";
import { AI_COMPLETION_PROVIDER } from "../ai.constants";
import type { AiProvider } from "./ai-provider.interface";
import { AiErrorHandler } from "../ai-error.handler";
import { LoggingService } from "../../logging/logging.service";

export interface CompletionRequestOptions {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
}

@Injectable()
export class AiProviderService {
  private readonly defaultModel = "gpt-4o-mini";
  private readonly previewModel = "gpt-5.1-codex";

  constructor(
    @Inject(AI_COMPLETION_PROVIDER) private readonly client: AiProvider,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly errorHandler: AiErrorHandler,
    private readonly loggingService: LoggingService
  ) {}

  async createCompletion(options: CompletionRequestOptions) {
    const model = this.selectModel();
    try {
      return await this.client.createCompletion({
        model,
        messages: options.messages,
        tools: options.tools,
        tool_choice: options.toolChoice ?? "auto",
      });
    } catch (error: any) {
      const shouldFallback =
        model === this.previewModel && this.isPreviewUnavailable(error);
      if (shouldFallback) {
        this.loggingService.warn(
          `Preview model ${this.previewModel} unavailable. Falling back to ${this.defaultModel}.`,
          AiProviderService.name
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
      this.handleProviderError(error, options, model);
    }
  }

  private selectModel(): string {
    return this.config.enablePreviewModel
      ? this.previewModel
      : this.defaultModel;
  }

  private isPreviewUnavailable(error: any): boolean {
    const message: string | undefined = error?.message;
    return Boolean(message?.includes("not found"));
  }

  private handleProviderError(
    error: unknown,
    options: CompletionRequestOptions,
    model: string
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
