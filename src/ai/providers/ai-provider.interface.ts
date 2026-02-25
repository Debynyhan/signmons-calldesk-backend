import type {
  AiCompletionResponse,
  AiProviderCompletionRequest,
} from "../types/ai-completion.types";

export type CompletionRequest = AiProviderCompletionRequest;

export interface IAiProviderClient {
  createCompletion(params: CompletionRequest): Promise<AiCompletionResponse>;
}
