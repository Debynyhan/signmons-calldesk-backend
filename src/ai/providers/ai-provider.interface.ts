import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export type CompletionRequest = ChatCompletionCreateParamsNonStreaming;

export interface AiProvider {
  createCompletion(
    params: CompletionRequest
  ): Promise<OpenAI.ChatCompletion>;
}
