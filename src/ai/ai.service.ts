import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { AiErrorHandler } from "./ai-error.handler";
import { SanitizationService } from "../sanitization/sanitization.service";
import { CALL_LOG_SERVICE, type ICallLogService } from "../logging/call-log.service.interface";
import { CONVERSATION_LIFECYCLE_SERVICE, type IConversationLifecycleService } from "../conversations/conversation-lifecycle.service.interface";
import { CONVERSATIONS_SERVICE, type IConversationsService } from "../conversations/conversations.service.interface";
import { CommunicationChannel } from "@prisma/client";
import type { AiChatMessageParam } from "./types/ai-completion.types";
import { AiExtractionService } from "./ai-extraction.service";
import {
  TriageOrchestratorService,
  type TriageOrchestratorResult,
} from "./triage-orchestrator.service";

@Injectable()
export class AiService {
  constructor(
    private readonly errorHandler: AiErrorHandler,
    private readonly sanitizationService: SanitizationService,
    @Inject(TENANTS_SERVICE) private readonly tenantsService: TenantsService,
    @Inject(CALL_LOG_SERVICE) private readonly callLogService: ICallLogService,
    @Inject(CONVERSATION_LIFECYCLE_SERVICE) private readonly conversationLifecycleService: IConversationLifecycleService,
    @Inject(CONVERSATIONS_SERVICE) private readonly conversationsService: IConversationsService,
    private readonly aiExtractionService: AiExtractionService,
    private readonly triageOrchestrator: TriageOrchestratorService,
  ) {}

  async triage(
    tenantId: string,
    sessionId: string,
    userMessage: string,
    options?: { conversationId?: string; channel?: CommunicationChannel },
  ): Promise<TriageOrchestratorResult> {
    let safeTenantId: string | undefined;
    let safeSessionId: string | undefined;
    const incomingMessageLength = userMessage?.length ?? 0;
    try {
      safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);
      const safeUserMessage =
        this.sanitizationService.sanitizeText(userMessage);
      safeSessionId = this.sanitizationService.sanitizeIdentifier(sessionId);

      if (!safeTenantId) {
        throw new BadRequestException("Invalid tenant identifier.");
      }

      if (!safeSessionId) {
        throw new BadRequestException("Invalid session identifier.");
      }

      if (!safeUserMessage) {
        throw new BadRequestException("Message must contain text.");
      }

      const tenantContext =
        await this.tenantsService.getTenantContext(safeTenantId);
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
      const tenantContextPrompt = tenantContext.prompt;
      const recentMessages = await this.callLogService.getRecentMessages(
        safeTenantId,
        safeSessionId,
        10,
      );
      const conversationHistory: AiChatMessageParam[] =
        recentMessages.map((entry) => ({
          role: entry.role,
          content: entry.content,
        }));

      return this.triageOrchestrator.run({
        tenantId: safeTenantId,
        sessionId: safeSessionId,
        conversationId: conversation.id,
        collectedData: conversation.collectedData as Record<string, unknown> | null,
        tenantContextPrompt,
        conversationHistory,
        userMessage: safeUserMessage,
        originalUserMessage: userMessage,
        channel: options?.channel,
        incomingMessageLength,
      });
    } catch (error) {
      this.errorHandler.handle(error, {
        tenantId: safeTenantId ?? tenantId,
        metadata: {
          sessionId: safeSessionId ?? sessionId,
        },
        stage: "triage",
        messageLength: incomingMessageLength,
        openAIResponseId: undefined,
      });
    }
  }

  extractNameCandidate(
    tenantId: string,
    transcript: string,
  ): Promise<string | null> {
    return this.aiExtractionService.extractNameCandidate(tenantId, transcript);
  }

  extractAddressCandidate(
    tenantId: string,
    transcript: string,
  ): Promise<{
    address: string | null;
    confidence?: number;
    houseNumber?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null> {
    return this.aiExtractionService.extractAddressCandidate(tenantId, transcript);
  }
}
