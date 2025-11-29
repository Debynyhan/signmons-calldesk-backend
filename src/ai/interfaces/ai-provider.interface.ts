import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

export interface CompletionRequestOptions {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
}

export interface IAiProvider {
  createCompletion(
    options: CompletionRequestOptions
  ): Promise<OpenAI.ChatCompletion>;
}
