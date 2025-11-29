import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export type CompletionRequest = ChatCompletionCreateParamsNonStreaming;

export interface IAiProviderClient {
  createCompletion(
    params: CompletionRequest
  ): Promise<OpenAI.ChatCompletion>;
}
