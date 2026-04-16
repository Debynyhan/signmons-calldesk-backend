import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ConversationsRepository } from "../conversations.repository";
import {
  getVoiceComfortRiskFromCollectedData,
  getVoiceUrgencyConfirmationFromCollectedData,
  type VoiceComfortRisk,
  type VoiceListeningWindow,
  type VoiceUrgencyConfirmation,
} from "../voice-conversation-state.codec";

type VoiceTurnTiming = {
  recordedAt: string;
  sttFinalMs: number | null;
  queueDelayMs: number | null;
  turnLogicMs: number;
  aiMs: number;
  aiCalls: number;
  ttsMs: number;
  twilioUpdateMs: number;
  transcriptChars: number;
  reason: string;
  twilioUpdated: boolean;
  usedGoogleTts: boolean;
  ttsCacheHit: boolean;
  ttsPolicy: "google_play" | "twilio_say";
  hangup: boolean;
  totalTurnMs?: number;
  latencyBreaches?: string[];
};

@Injectable()
export class VoiceTurnOrchestrationStateService {
  constructor(private readonly repository: ConversationsRepository) {}

  async updateVoiceIssueCandidate(params: {
    tenantId: string;
    conversationId: string;
    issue: { value: string; sourceEventId: string; createdAt: string };
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
    const existing = current.issueCandidate as
      | { value?: string | null }
      | undefined;
    if (existing?.value) {
      return conversation;
    }

    const merged = {
      ...current,
      issueCandidate: params.issue,
    } as Prisma.InputJsonValue;

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async incrementVoiceTurn(params: {
    tenantId: string;
    conversationId: string;
    now?: Date;
  }): Promise<{
    conversation: { id: string; collectedData: Prisma.JsonValue };
    voiceTurnCount: number;
    voiceStartedAt: string;
  } | null> {
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
    const previousCount =
      typeof current.voiceTurnCount === "number" ? current.voiceTurnCount : 0;
    const now = params.now ?? new Date();
    const startedAt =
      typeof current.voiceStartedAt === "string"
        ? current.voiceStartedAt
        : now.toISOString();
    const nextCount = previousCount + 1;

    const merged: Prisma.InputJsonValue = {
      ...current,
      voiceTurnCount: nextCount,
      voiceStartedAt: startedAt,
    };

    const updated = await this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });

    return {
      conversation: updated,
      voiceTurnCount: nextCount,
      voiceStartedAt: startedAt,
    };
  }

  async updateVoiceComfortRisk(params: {
    tenantId: string;
    conversationId: string;
    comfortRisk: Partial<VoiceComfortRisk>;
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
    const existing = getVoiceComfortRiskFromCollectedData(
      current as Prisma.JsonValue,
    );
    const next: VoiceComfortRisk = {
      askedAt:
        typeof params.comfortRisk.askedAt === "string"
          ? params.comfortRisk.askedAt
          : existing.askedAt,
      response:
        params.comfortRisk.response === "YES" ||
        params.comfortRisk.response === "NO"
          ? params.comfortRisk.response
          : existing.response,
      sourceEventId:
        typeof params.comfortRisk.sourceEventId === "string"
          ? params.comfortRisk.sourceEventId
          : existing.sourceEventId,
    };

    const merged: Prisma.InputJsonValue = {
      ...current,
      voiceComfortRisk: next,
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async updateVoiceUrgencyConfirmation(params: {
    tenantId: string;
    conversationId: string;
    urgencyConfirmation: Partial<VoiceUrgencyConfirmation>;
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
    const existing = getVoiceUrgencyConfirmationFromCollectedData(
      current as Prisma.JsonValue,
    );
    const next: VoiceUrgencyConfirmation = {
      askedAt:
        typeof params.urgencyConfirmation.askedAt === "string"
          ? params.urgencyConfirmation.askedAt
          : existing.askedAt,
      response:
        params.urgencyConfirmation.response === "YES" ||
        params.urgencyConfirmation.response === "NO"
          ? params.urgencyConfirmation.response
          : existing.response,
      sourceEventId:
        typeof params.urgencyConfirmation.sourceEventId === "string"
          ? params.urgencyConfirmation.sourceEventId
          : existing.sourceEventId,
    };

    const merged: Prisma.InputJsonValue = {
      ...current,
      voiceUrgencyConfirmation: next,
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async updateVoiceListeningWindow(params: {
    tenantId: string;
    conversationId: string;
    window: VoiceListeningWindow;
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
      voiceListeningWindow: params.window,
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async clearVoiceListeningWindow(params: {
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
    delete mergedRecord.voiceListeningWindow;
    const merged = mergedRecord as Prisma.InputJsonValue;

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async updateVoiceLastEventId(params: {
    tenantId: string;
    conversationId: string;
    eventId: string;
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
      voiceLastEventId: params.eventId,
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async appendVoiceTurnTiming(params: {
    tenantId: string;
    callSid: string;
    timing: Omit<VoiceTurnTiming, "recordedAt"> & { recordedAt?: string };
    maxHistory?: number;
  }) {
    const conversation = await this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        twilioCallSid: params.callSid,
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
    const existingHistoryRaw = Array.isArray(current.voiceTurnTimings)
      ? current.voiceTurnTimings
      : [];
    const existingHistory = existingHistoryRaw.filter(
      (entry) => entry && typeof entry === "object",
    ) as Prisma.InputJsonValue[];
    const maxHistory = Math.min(100, Math.max(1, params.maxHistory ?? 30));
    const timingRecord: VoiceTurnTiming = {
      ...params.timing,
      recordedAt: params.timing.recordedAt ?? new Date().toISOString(),
    };
    const nextHistory = [...existingHistory, timingRecord].slice(-maxHistory);
    const merged: Prisma.InputJsonValue = {
      ...current,
      lastVoiceTurnTiming: timingRecord,
      voiceTurnTimings: nextHistory,
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }
}
