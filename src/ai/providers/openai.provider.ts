import { Inject, Injectable } from "@nestjs/common";
import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { OPENAI_CLIENT } from "../ai.constants";
import type {
  IAiProviderClient,
  CompletionRequest,
} from "./ai-provider.interface";
import type {
  AiAssistantMessage,
  AiAssistantMessageContentPart,
  AiCompletionResponse,
  AiToolCall,
} from "../types/ai-completion.types";

@Injectable()
export class OpenAiProvider implements IAiProviderClient {
  constructor(@Inject(OPENAI_CLIENT) private readonly client: OpenAI) {}

  async createCompletion(params: CompletionRequest): Promise<AiCompletionResponse> {
    const request = this.toOpenAiRequest(params);
    const response = await this.client.chat.completions.create(request);
    return this.fromOpenAiResponse(response);
  }

  private toOpenAiRequest(
    params: CompletionRequest,
  ): ChatCompletionCreateParamsNonStreaming {
    const request: ChatCompletionCreateParamsNonStreaming = {
      model: params.model,
      messages: params.messages as ChatCompletionMessageParam[],
    };

    if (typeof params.maxTokens === "number") {
      request.max_tokens = params.maxTokens;
    }
    if (typeof params.temperature === "number") {
      request.temperature = params.temperature;
    }
    if (params.tools && params.tools.length > 0) {
      request.tools = params.tools as ChatCompletionTool[];
      request.tool_choice = params.toolChoice ?? "auto";
    }

    return request;
  }

  private fromOpenAiResponse(response: OpenAI.ChatCompletion): AiCompletionResponse {
    return {
      id: response.id,
      model: response.model,
      choices: response.choices.map((choice) => ({
        message: this.mapAssistantMessage(choice.message),
      })),
    };
  }

  private mapAssistantMessage(
    message: OpenAI.ChatCompletionMessage,
  ): AiAssistantMessage {
    const content = Array.isArray(message.content)
      ? message.content.map((part): AiAssistantMessageContentPart =>
          typeof part === "string"
            ? part
            : { text: (part as { text?: string }).text },
        )
      : message.content;

    const tool_calls: AiToolCall[] | undefined = message.tool_calls?.map(
      (toolCall) => ({
        id: toolCall.id,
        type: toolCall.type,
        function:
          toolCall.type === "function" && "function" in toolCall
            ? {
                name: toolCall.function?.name,
                arguments: toolCall.function?.arguments ?? null,
              }
            : undefined,
      }),
    );

    return {
      role: "assistant",
      content,
      refusal: typeof message.refusal === "string" ? message.refusal : null,
      ...(tool_calls?.length ? { tool_calls } : {}),
    };
  }
}
