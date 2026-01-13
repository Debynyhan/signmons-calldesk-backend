import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";

export type ToolExecutionContext = {
  tenantId: string;
  sessionId: string;
  rawArgs?: string;
};

export type ToolExecutionLog = {
  transcript: string;
  aiResponse: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
};

export type ToolExecutionResult = {
  response: Record<string, unknown>;
  log?: ToolExecutionLog;
  clearSession?: boolean;
};

export type ToolDefinition = {
  tool: ChatCompletionTool;
  execute: (context: ToolExecutionContext) => Promise<ToolExecutionResult>;
};
