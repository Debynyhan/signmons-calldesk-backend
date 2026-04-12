import { BadRequestException, Injectable } from "@nestjs/common";
import { CommunicationChannel } from "@prisma/client";
import { AiErrorHandler } from "./ai-error.handler";
import { LoggingService } from "../logging/logging.service";
import { ToolExecutorRegistryService } from "./tools/tool-executor.registry";
import type { RegisteredToolExecutionResult } from "./tools/tool.types";
import { getRequestContext } from "../common/context/request-context";
import type { AiRouteIntent } from "./routing/ai-route-state";

export interface ToolDispatchContext {
  tenantId: string;
  sessionId: string;
  conversationId: string;
  name: string;
  rawArgs?: string;
  model?: string;
  channel?: CommunicationChannel;
  routeContinuationCount?: number;
  currentRouteIntent?: AiRouteIntent | null;
}

export type ToolDispatchResult =
  | RegisteredToolExecutionResult
  | { status: "tool_called"; toolName: string; rawArgs: string | null }
  | { status: "unsupported_tool"; toolName: string; rawArgs?: string };

@Injectable()
export class ToolDispatchService {
  constructor(
    private readonly loggingService: LoggingService,
    private readonly toolExecutorRegistry: ToolExecutorRegistryService,
    private readonly errorHandler: AiErrorHandler,
  ) {}

  async dispatch(context: ToolDispatchContext): Promise<ToolDispatchResult> {
    const {
      tenantId,
      sessionId,
      conversationId,
      name,
      rawArgs,
      model,
      channel,
      routeContinuationCount,
      currentRouteIntent,
    } = context;
    try {
      this.logAiTrace("log", tenantId, "ai.tool_dispatch", {
        toolName: name,
        channel,
        model,
        routeContinuationCount,
        currentRouteIntent,
      });
      const executor = this.toolExecutorRegistry.get(name);
      if (!executor) {
        this.logAiTrace("warn", tenantId, "ai.unsupported_tool_called", {
          toolName: name,
          channel,
          model,
        });
        return {
          status: "unsupported_tool",
          toolName: name,
          rawArgs,
        };
      }
      const result = await executor.execute({
        tenantId,
        sessionId,
        conversationId,
        rawArgs,
        model,
        channel,
        routeContinuationCount,
        currentRouteIntent,
      });
      this.logAiTrace("log", tenantId, "ai.tool_result", {
        toolName: name,
        channel,
        model,
        status: (result as { status?: string }).status,
      });
      return result;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "";
      if (
        name === "route_conversation" &&
        error instanceof BadRequestException &&
        message.includes("Repeated route tool call")
      ) {
        this.logAiTrace("warn", tenantId, "ai.route_loop_guard_triggered", {
          channel,
          model,
          routeContinuationCount,
          currentRouteIntent,
        });
      }
      this.logAiTrace("warn", tenantId, "ai.tool_error", {
        toolName: name,
        channel,
        model,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      if (error instanceof BadRequestException) {
        this.logAiEvent(tenantId, "ai.invalid_output", {
          model,
          reason: "tool_args_invalid",
        });
      }
      this.errorHandler.handle(error, {
        tenantId,
        toolName: name,
        stage: "tool_call",
        metadata: {
          rawArgsLength: rawArgs?.length ?? 0,
        },
      });
    }
  }

  private logAiEvent(
    tenantId: string,
    event: "ai.invalid_output",
    details: { model?: string; reason: string },
  ) {
    const context = getRequestContext();
    const payload: Record<string, unknown> = {
      event,
      tenantId,
      requestId: context?.requestId,
      model: details.model,
      reason: details.reason,
    };
    if (context?.callSid) {
      payload.callSid = context.callSid;
    }
    if (context?.conversationId) {
      payload.conversationId = context.conversationId;
    }
    this.loggingService.warn(payload, ToolDispatchService.name);
  }

  private logAiTrace(
    level: "log" | "warn",
    tenantId: string,
    event: string,
    details: Record<string, unknown>,
  ) {
    const context = getRequestContext();
    const payload: Record<string, unknown> = {
      event,
      tenantId,
      requestId: context?.requestId,
      ...details,
    };
    if (context?.callSid) {
      payload.callSid = context.callSid;
    }
    if (context?.conversationId) {
      payload.conversationId = context.conversationId;
    }
    if (level === "warn") {
      this.loggingService.warn(payload, ToolDispatchService.name);
      return;
    }
    this.loggingService.log(payload, ToolDispatchService.name);
  }
}
