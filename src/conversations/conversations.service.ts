import { Injectable } from "@nestjs/common";
import {
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildAiRouteState,
  type AiRouteIntent,
} from "../ai/routing/ai-route-state";
import { ConversationsRepository } from "./conversations.repository";
import {
  getVoiceAddressStateFromCollectedData,
  getVoiceComfortRiskFromCollectedData,
  getVoiceNameStateFromCollectedData,
  getVoiceSmsHandoffFromCollectedData,
  getVoiceSmsPhoneStateFromCollectedData,
  getVoiceUrgencyConfirmationFromCollectedData,
  type VoiceAddressState,
  type VoiceComfortRisk,
  type VoiceNameState,
  type VoiceSmsHandoff,
  type VoiceSmsPhoneState,
  type VoiceUrgencyConfirmation,
} from "./voice-conversation-state.codec";

@Injectable()
export class ConversationsService {
  private readonly repository: ConversationsRepository;

  constructor(private readonly prisma: PrismaService) {
    this.repository = new ConversationsRepository(this.prisma);
  }

  async getVoiceConversationByCallSid(params: {
    tenantId: string;
    callSid: string;
  }) {
    return this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        twilioCallSid: params.callSid,
      },
    });
  }

  async getConversationBySmsSid(params: { tenantId: string; smsSid: string }) {
    return this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        twilioSmsSid: params.smsSid,
      },
    });
  }

  async getConversationById(params: {
    tenantId: string;
    conversationId: string;
  }) {
    return this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
    });
  }

  async setAiRouteIntent(params: {
    tenantId: string;
    conversationId: string;
    intent: AiRouteIntent;
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
      aiRoute: buildAiRouteState(params.intent),
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  getVoiceNameState(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceNameState {
    return getVoiceNameStateFromCollectedData(collectedData);
  }

  getVoiceSmsPhoneState(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceSmsPhoneState {
    return getVoiceSmsPhoneStateFromCollectedData(collectedData);
  }

  getVoiceSmsHandoff(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceSmsHandoff | null {
    return getVoiceSmsHandoffFromCollectedData(collectedData);
  }

  getVoiceAddressState(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceAddressState {
    return getVoiceAddressStateFromCollectedData(collectedData);
  }

  getVoiceComfortRisk(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceComfortRisk {
    return getVoiceComfortRiskFromCollectedData(collectedData);
  }

  getVoiceUrgencyConfirmation(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceUrgencyConfirmation {
    return getVoiceUrgencyConfirmationFromCollectedData(collectedData);
  }

}
