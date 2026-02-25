import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";
import type { CommunicationChannel } from "@prisma/client";
import type { AiRouteIntent } from "../routing/ai-route-state";

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

export type RegisteredToolExecutionContext = {
  tenantId: string;
  sessionId: string;
  conversationId: string;
  rawArgs?: string;
  model?: string;
  channel?: CommunicationChannel;
  routeContinuationCount?: number;
  currentRouteIntent?: AiRouteIntent | null;
};

export type RegisteredToolExecutionResult =
  | {
      status: "continue";
      intent: AiRouteIntent;
    }
  | {
      status: "reply";
      reply: string;
      outcome?: string;
      reason?: string;
    }
  | {
      status: "job_created";
      job: unknown;
      message: string;
    };

export type RegisteredToolExecutor = {
  toolName: string;
  execute: (
    context: RegisteredToolExecutionContext,
  ) => Promise<RegisteredToolExecutionResult>;
};
