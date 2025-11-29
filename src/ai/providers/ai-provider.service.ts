import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import appConfig from "../../config/app.config";
import { AI_COMPLETION_PROVIDER } from "../ai.constants";
import type { AiProvider } from "./ai-provider.interface";

export interface CompletionRequestOptions {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
}

@Injectable()
export class AiProviderService {
  private readonly defaultModel = "gpt-4o-mini";
  private readonly previewModel = "gpt-5.1-codex";
  private readonly logger = new Logger(AiProviderService.name);

  constructor(
    @Inject(AI_COMPLETION_PROVIDER) private readonly client: AiProvider,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>
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
        this.logger.warn(
          `Preview model ${this.previewModel} unavailable. Falling back to ${this.defaultModel}.`
        );
        return this.client.createCompletion({
          model: this.defaultModel,
          messages: options.messages,
          tools: options.tools,
          tool_choice: options.toolChoice ?? "auto",
        });
      }
      throw error;
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
}
