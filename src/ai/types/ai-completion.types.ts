export type AiChatMessageRole = "system" | "user" | "assistant";

export type AiChatMessageParam = {
  role: AiChatMessageRole;
  content: string;
};

export type AiToolChoiceOption = "auto" | "none";

export type AiCompletionChannel = "TEXT" | "VOICE";

export type AiCompletionLane =
  | "TRIAGE_ROUTER"
  | "TRIAGE_BOOKING"
  | "TRIAGE_FAQ"
  | "TRIAGE_VOICE"
  | "TRIAGE_TEXT_FALLBACK"
  | "EXTRACTION_NAME"
  | "EXTRACTION_ADDRESS";

export type AiCompletionContext = {
  channel?: AiCompletionChannel;
  lane?: AiCompletionLane;
};

export type AiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
};

export interface AiCompletionRequestOptions {
  messages: AiChatMessageParam[];
  tools?: AiToolDefinition[];
  toolChoice?: AiToolChoiceOption;
  maxTokens?: number;
  temperature?: number;
  context?: AiCompletionContext;
}

export interface AiProviderCompletionRequest extends AiCompletionRequestOptions {
  model: string;
}

export type AiToolCall = {
  id?: string;
  type: string;
  function?: {
    name?: string;
    arguments?: string | null;
  };
};

export type AiAssistantMessageContentPart = string | { text?: string };

export type AiAssistantMessage = {
  role: "assistant";
  content: string | AiAssistantMessageContentPart[] | null;
  refusal?: string | null;
  tool_calls?: AiToolCall[];
};

export type AiCompletionChoice = {
  message: AiAssistantMessage;
};

export type AiCompletionResponse = {
  id?: string;
  model?: string;
  choices: AiCompletionChoice[];
};
