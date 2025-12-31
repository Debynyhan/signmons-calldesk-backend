import { Injectable } from "@nestjs/common";
import OpenAI from "openai";
import type {
  IAiProviderClient,
  CompletionRequest,
} from "./ai-provider.interface";

@Injectable()
export class OpenAiProvider implements IAiProviderClient {
  constructor(private readonly client: OpenAI) {}

  createCompletion(params: CompletionRequest) {
    return this.client.chat.completions.create(params);
  }
}
