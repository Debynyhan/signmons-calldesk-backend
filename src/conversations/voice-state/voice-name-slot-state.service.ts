import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ConversationsRepository } from "../conversations.repository";
import {
  mergeLockedVoiceNameState,
  parseVoiceNameState,
  type VoiceFieldConfirmation,
  type VoiceNameState,
} from "../voice-conversation-state.codec";

@Injectable()
export class VoiceNameSlotStateService {
  constructor(private readonly repository: ConversationsRepository) {}

  async updateVoiceNameState(params: {
    tenantId: string;
    conversationId: string;
    nameState: VoiceNameState;
    confirmation?: VoiceFieldConfirmation;
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
    const currentName = parseVoiceNameState(current.name);
    const nextName = mergeLockedVoiceNameState(currentName, params.nameState);
    const confirmations: Prisma.InputJsonValue[] = Array.isArray(
      current.fieldConfirmations,
    )
      ? (current.fieldConfirmations.slice() as Prisma.InputJsonValue[])
      : [];
    const confirmation = params.confirmation;
    if (confirmation) {
      const exists = confirmations.some(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          (entry as { field?: string; sourceEventId?: string }).field ===
            confirmation.field &&
          (entry as { sourceEventId?: string }).sourceEventId ===
            confirmation.sourceEventId,
      );
      if (!exists) {
        confirmations.push(confirmation as Prisma.InputJsonValue);
      }
    }

    const merged: Prisma.InputJsonValue = {
      ...current,
      name: nextName,
      ...(confirmations.length ? { fieldConfirmations: confirmations } : {}),
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async promoteNameFromSms(params: {
    tenantId: string;
    conversationId: string;
    value: string;
    sourceEventId: string;
    confirmedAt?: string;
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
    const currentName = parseVoiceNameState(current.name);
    const confirmedAt = params.confirmedAt ?? new Date().toISOString();
    const nextNameState: VoiceNameState = {
      ...currentName,
      confirmed: {
        value: params.value,
        sourceEventId: params.sourceEventId,
        confirmedAt,
      },
      status: "CONFIRMED",
      locked: true,
    };

    return this.updateVoiceNameState({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      nameState: nextNameState,
      confirmation: {
        field: "name",
        value: params.value,
        confirmedAt,
        sourceEventId: params.sourceEventId,
        channel: "SMS",
      },
    });
  }
}
