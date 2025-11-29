import { Inject, Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { OPENAI_CLIENT } from "../ai.constants";
import type {
  IAiProviderClient,
  CompletionRequest,
} from "./ai-provider.interface";

@Injectable()
export class OpenAiProvider implements IAiProviderClient {
  constructor(@Inject(OPENAI_CLIENT) private readonly client: OpenAI) {}

  createCompletion(params: CompletionRequest) {
    return this.client.chat.completions.create(params);
  }
}
