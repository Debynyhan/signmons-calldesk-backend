import { Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { VertexAI } from "@google-cloud/vertexai";
import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import appConfig from "../../config/app.config";
import type {
  CompletionRequest,
  IAiProviderClient,
} from "./ai-provider.interface";

type VertexToolConfig = {
  functionCallingConfig?: {
    mode: "AUTO" | "ANY" | "NONE";
    allowedFunctionNames?: string[];
  };
};

type VertexAiModel = {
  generateContent: (request: {
    contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
    tools?: Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
    toolConfig?: VertexToolConfig;
    systemInstruction?: { parts: Array<{ text: string }> };
  }) => Promise<unknown>;
};

type VertexAiClient = {
  getGenerativeModel: (args: { model: string }) => VertexAiModel;
};

@Injectable()
export class VertexAiProvider implements IAiProviderClient {
  private readonly vertex: VertexAiClient;

  constructor(private readonly config: ConfigType<typeof appConfig>) {
    const VertexConstructor = VertexAI as unknown as new (args: {
      project: string;
      location: string;
    }) => VertexAiClient;
    this.vertex = new VertexConstructor({
      project: this.config.vertexProjectId,
      location: this.config.vertexLocation,
    });
  }

  async createCompletion(
    params: CompletionRequest,
  ): Promise<OpenAI.ChatCompletion> {
    const { systemInstruction, contents } = this.buildContents(params.messages);
    const toolDeclarations = this.buildTools(params.tools);
    const toolConfig = this.buildToolConfig(params.tool_choice);
    const modelName = params.model || this.config.vertexModel;

    const model = this.vertex.getGenerativeModel({ model: modelName });
    const response = await model.generateContent({
      contents,
      tools: toolDeclarations.length
        ? [{ functionDeclarations: toolDeclarations }]
        : undefined,
      toolConfig,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction }] }
        : undefined,
    });

    return this.toChatCompletion(response, modelName);
  }

  private buildContents(messages: ChatCompletionMessageParam[]): {
    systemInstruction: string | null;
    contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  } {
    const systemChunks: string[] = [];
    const contents: Array<{
      role: "user" | "model";
      parts: Array<{ text: string }>;
    }> = [];

    for (const message of messages) {
      const text = this.extractText(message);
      if (!text) {
        continue;
      }
      if (message.role === "system") {
        systemChunks.push(text);
        continue;
      }
      const role = message.role === "assistant" ? "model" : "user";
      contents.push({ role, parts: [{ text }] });
    }

    return {
      systemInstruction: systemChunks.length ? systemChunks.join("\n") : null,
      contents,
    };
  }

  private extractText(message: ChatCompletionMessageParam): string {
    if (typeof message.content === "string") {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) =>
          typeof part === "string"
            ? part
            : ((part as { text?: string })?.text ?? ""),
        )
        .filter(Boolean)
        .join("\n");
    }
    return "";
  }

  private buildTools(tools?: ChatCompletionTool[]) {
    if (!tools?.length) {
      return [];
    }
    return tools
      .filter((tool) => tool.type === "function")
      .map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
      }));
  }

  private buildToolConfig(
    choice: CompletionRequest["tool_choice"],
  ): VertexToolConfig | undefined {
    if (!choice || choice === "auto") {
      return { functionCallingConfig: { mode: "AUTO" } };
    }
    if (choice === "none") {
      return { functionCallingConfig: { mode: "NONE" } };
    }
    if (typeof choice === "object" && "function" in choice) {
      const name = choice.function?.name;
      return {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: name ? [name] : undefined,
        },
      };
    }
    return { functionCallingConfig: { mode: "AUTO" } };
  }

  private toChatCompletion(
    response: unknown,
    model: string,
  ): OpenAI.ChatCompletion {
    const responsePayload =
      response && typeof response === "object" && "response" in response
        ? (response as { response?: unknown }).response
        : response;
    const candidates =
      responsePayload &&
      typeof responsePayload === "object" &&
      "candidates" in responsePayload
        ? (responsePayload as { candidates?: Array<Record<string, unknown>> })
            .candidates
        : undefined;
    const candidate = candidates?.[0];
    const content =
      candidate && typeof candidate === "object" && "content" in candidate
        ? (
            candidate as {
              content?: { parts?: Array<Record<string, unknown>> };
            }
          ).content
        : undefined;
    const parts = content?.parts ?? [];
    const textParts: string[] = [];
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

    parts.forEach((part, index) => {
      const text = part.text;
      if (typeof text === "string" && text.length) {
        textParts.push(text);
      }
      const functionCall = part.functionCall as
        | { name?: string; args?: Record<string, unknown> }
        | undefined;
      if (functionCall?.name) {
        toolCalls.push({
          id: `call_${index + 1}`,
          type: "function",
          function: {
            name: functionCall.name,
            arguments: JSON.stringify(functionCall.args ?? {}),
          },
        });
      }
    });

    const message: OpenAI.ChatCompletionMessage = {
      role: "assistant",
      content: textParts.length ? textParts.join("\n") : null,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      refusal: null,
    };

    const usage =
      responsePayload &&
      typeof responsePayload === "object" &&
      "usageMetadata" in responsePayload
        ? (responsePayload as { usageMetadata?: Record<string, unknown> })
            .usageMetadata
        : undefined;

    const promptTokens = Number(
      usage?.promptTokenCount ?? usage?.promptTokens ?? 0,
    );
    const completionTokens = Number(
      usage?.candidatesTokenCount ?? usage?.completionTokens ?? 0,
    );
    const totalTokens = Number(
      usage?.totalTokenCount ?? promptTokens + completionTokens,
    );

    return {
      id: `vertex-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          finish_reason: toolCalls.length ? "tool_calls" : "stop",
          message,
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    };
  }
}
