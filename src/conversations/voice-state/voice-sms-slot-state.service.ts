import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ConversationsRepository } from "../conversations.repository";
import type {
  VoiceSmsHandoff,
  VoiceSmsPhoneState,
} from "../voice-conversation-state.codec";

@Injectable()
export class VoiceSmsSlotStateService {
  constructor(private readonly repository: ConversationsRepository) {}

  async updateVoiceSmsPhoneState(params: {
    tenantId: string;
    conversationId: string;
    phoneState: VoiceSmsPhoneState;
  }) {
    const conversation = await this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<
      string,
      unknown
    >;
    const merged: Prisma.InputJsonValue = {
      ...current,
      smsPhone: params.phoneState,
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async updateVoiceSmsHandoff(params: {
    tenantId: string;
    conversationId: string;
    handoff: VoiceSmsHandoff;
  }) {
    const conversation = await this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<
      string,
      unknown
    >;
    const merged: Prisma.InputJsonValue = {
      ...current,
      voiceSmsHandoff: params.handoff,
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async clearVoiceSmsHandoff(params: {
    tenantId: string;
    conversationId: string;
  }) {
    const conversation = await this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<
      string,
      unknown
    >;
    const mergedRecord: Record<string, unknown> = { ...current };
    delete mergedRecord.voiceSmsHandoff;
    const merged = mergedRecord as Prisma.InputJsonValue;

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }
}
