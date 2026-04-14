import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { CommunicationChannel } from "@prisma/client";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import {
  CONVERSATION_LIFECYCLE_SERVICE,
  type IConversationLifecycleService,
} from "../conversations/conversation-lifecycle.service.interface";
import {
  CONVERSATIONS_SERVICE,
  type IConversationsService,
} from "../conversations/conversations.service.interface";
import {
  CALL_LOG_SERVICE,
  type ICallLogService,
} from "../logging/call-log.service.interface";
import { SanitizationService } from "../sanitization/sanitization.service";
import type { AiChatMessageParam } from "./types/ai-completion.types";

export type TriageContext = {
  tenantId: string;
  sessionId: string;
  conversationId: string;
  tenantContextPrompt: string;
  conversationHistory: AiChatMessageParam[];
  collectedData: Record<string, unknown> | null;
};

@Injectable()
export class TriageContextBuilderService {
  constructor(
    private readonly sanitizationService: SanitizationService,
    @Inject(TENANTS_SERVICE) private readonly tenantsService: TenantsService,
    @Inject(CONVERSATION_LIFECYCLE_SERVICE)
    private readonly conversationLifecycleService: IConversationLifecycleService,
    @Inject(CONVERSATIONS_SERVICE)
    private readonly conversationsService: IConversationsService,
    @Inject(CALL_LOG_SERVICE) private readonly callLogService: ICallLogService,
  ) {}

  async build(
    tenantId: string,
    sessionId: string,
    options?: { conversationId?: string; channel?: CommunicationChannel },
  ): Promise<TriageContext> {
    const safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);
    const safeSessionId = this.sanitizationService.sanitizeIdentifier(sessionId);

    if (!safeTenantId) {
      throw new BadRequestException("Invalid tenant identifier.");
    }
    if (!safeSessionId) {
      throw new BadRequestException("Invalid session identifier.");
    }

    const tenantContext = await this.tenantsService.getTenantContext(safeTenantId);
    const conversation = options?.conversationId
      ? await this.conversationsService.getConversationById({
          tenantId: safeTenantId,
          conversationId: options.conversationId,
        })
      : await this.conversationLifecycleService.ensureConversation(
          safeTenantId,
          safeSessionId,
        );

    if (!conversation) {
      throw new BadRequestException("Conversation not found.");
    }

    const recentMessages = await this.callLogService.getRecentMessages(
      safeTenantId,
      safeSessionId,
      10,
    );
    const conversationHistory: AiChatMessageParam[] = recentMessages.map(
      (entry) => ({ role: entry.role, content: entry.content }),
    );

    return {
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      conversationId: conversation.id,
      tenantContextPrompt: tenantContext.prompt,
      conversationHistory,
      collectedData: conversation.collectedData as Record<string, unknown> | null,
    };
  }
}
