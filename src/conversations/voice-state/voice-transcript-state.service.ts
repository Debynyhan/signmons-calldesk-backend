import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { SanitizationService } from "../../sanitization/sanitization.service";
import { ConversationsRepository } from "../conversations.repository";

@Injectable()
export class VoiceTranscriptStateService {
  constructor(
    private readonly repository: ConversationsRepository,
    private readonly sanitizationService: SanitizationService,
  ) {}

  async updateVoiceTranscript(params: {
    tenantId: string;
    callSid: string;
    transcript: string;
    confidence?: number;
  }) {
    const normalized = this.sanitizationService.normalizeWhitespace(
      params.transcript,
    );
    if (!normalized) {
      return null;
    }

    const conversation = await this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        twilioCallSid: params.callSid,
      },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<
      string,
      unknown
    >;
    const merged = {
      ...current,
      lastTranscript: normalized,
      lastTranscriptAt: new Date().toISOString(),
      ...(typeof params.confidence === "number"
        ? { lastTranscriptConfidence: params.confidence }
        : {}),
    } as Prisma.InputJsonValue;

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
    });
  }
}
