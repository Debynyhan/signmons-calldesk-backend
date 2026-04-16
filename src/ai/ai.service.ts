import { BadRequestException, Injectable } from "@nestjs/common";
import type { CommunicationChannel } from "@prisma/client";
import { SanitizationService } from "../sanitization/sanitization.service";
import { AiErrorHandler } from "./ai-error.handler";
import { AiExtractionService } from "./ai-extraction.service";
import type { AiAddressCandidate, IAiService } from "./ai.service.interface";
import {
  TriageOrchestratorService,
  type TriageOrchestratorResult,
} from "./triage-orchestrator.service";
import { TriageContextBuilderService } from "./triage-context-builder.service";

@Injectable()
export class AiService implements IAiService {
  constructor(
    private readonly errorHandler: AiErrorHandler,
    private readonly sanitizationService: SanitizationService,
    private readonly aiExtractionService: AiExtractionService,
    private readonly triageOrchestrator: TriageOrchestratorService,
    private readonly triageContextBuilder: TriageContextBuilderService,
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
      const safeUserMessage = this.sanitizationService.sanitizeText(userMessage);
      if (!safeUserMessage) {
        throw new BadRequestException("Message must contain text.");
      }
      const context = await this.triageContextBuilder.build(tenantId, sessionId, options);
      safeTenantId = context.tenantId;
      safeSessionId = context.sessionId;
      return this.triageOrchestrator.run({
        ...context,
        userMessage: safeUserMessage,
        originalUserMessage: userMessage,
        incomingMessageLength,
        channel: options?.channel,
      });
    } catch (error) {
      this.errorHandler.handle(error, {
        tenantId: safeTenantId ?? tenantId,
        metadata: { sessionId: safeSessionId ?? sessionId },
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
  ): Promise<AiAddressCandidate | null> {
    return this.aiExtractionService.extractAddressCandidate(tenantId, transcript);
  }
}
