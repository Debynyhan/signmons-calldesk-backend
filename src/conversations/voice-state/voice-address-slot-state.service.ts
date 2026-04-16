import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ConversationsRepository } from "../conversations.repository";
import {
  mergeLockedVoiceAddressState,
  parseVoiceAddressState,
  type VoiceAddressState,
  type VoiceFieldConfirmation,
} from "../voice-conversation-state.codec";

@Injectable()
export class VoiceAddressSlotStateService {
  constructor(private readonly repository: ConversationsRepository) {}

  async updateVoiceAddressState(params: {
    tenantId: string;
    conversationId: string;
    addressState: VoiceAddressState;
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
    const currentAddress = parseVoiceAddressState(current.address);
    const nextAddress = mergeLockedVoiceAddressState(
      currentAddress,
      params.addressState,
    );
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
      address: nextAddress,
      ...(confirmations.length ? { fieldConfirmations: confirmations } : {}),
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async promoteAddressFromSms(params: {
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
    const currentAddress = parseVoiceAddressState(current.address);
    const confirmedAt = params.confirmedAt ?? new Date().toISOString();
    const nextAddressState: VoiceAddressState = {
      ...currentAddress,
      confirmed: params.value,
      status: "CONFIRMED",
      locked: true,
      sourceEventId: params.sourceEventId,
    };

    return this.updateVoiceAddressState({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      addressState: nextAddressState,
      confirmation: {
        field: "address",
        value: params.value,
        confirmedAt,
        sourceEventId: params.sourceEventId,
        channel: "SMS",
      },
    });
  }
}
