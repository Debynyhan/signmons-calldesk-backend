import type {
  AiCompletionRequestOptions,
  AiCompletionResponse,
} from "../types/ai-completion.types";

export type CompletionRequestOptions = AiCompletionRequestOptions;

export interface IAiProvider {
  createCompletion(
    options: CompletionRequestOptions,
  ): Promise<AiCompletionResponse>;
}
