import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { CONVERSATIONS_SERVICE, type IConversationsService } from "../../conversations/conversations.service.interface";
import {
  isAiRouteIntent,
  type AiRouteIntent,
} from "../routing/ai-route-state";
import type {
  RegisteredToolExecutionContext,
  RegisteredToolExecutionResult,
  RegisteredToolExecutor,
} from "./tool.types";

@Injectable()
export class RouteConversationToolExecutor implements RegisteredToolExecutor {
  readonly toolName = "route_conversation";

  constructor(@Inject(CONVERSATIONS_SERVICE) private readonly conversationsService: IConversationsService) {}

  async execute(
    context: RegisteredToolExecutionContext,
  ): Promise<RegisteredToolExecutionResult> {
    const { intent } = this.parseArgs(context.rawArgs);

    if ((context.routeContinuationCount ?? 0) >= 1) {
      throw new BadRequestException("Repeated route tool call.");
    }

    const updatedConversation = await this.conversationsService.setAiRouteIntent({
      tenantId: context.tenantId,
      conversationId: context.conversationId,
      intent,
    });

    if (!updatedConversation) {
      throw new BadRequestException("Conversation not found.");
    }

    return {
      status: "continue",
      intent,
    };
  }

  private parseArgs(rawArgs?: string): { intent: AiRouteIntent } {
    if (!rawArgs?.trim()) {
      throw new BadRequestException("Tool call arguments missing.");
    }

    let parsed: { intent?: unknown };
    try {
      parsed = JSON.parse(rawArgs) as { intent?: unknown };
    } catch {
      throw new BadRequestException("Invalid route tool arguments.");
    }

    if (!isAiRouteIntent(parsed.intent)) {
      throw new BadRequestException("Invalid route intent.");
    }

    return { intent: parsed.intent };
  }
}
