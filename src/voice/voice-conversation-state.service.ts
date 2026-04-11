import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { SanitizationService } from "../sanitization/sanitization.service";
import { ConversationsRepository } from "../conversations/conversations.repository";
import {
  getVoiceComfortRiskFromCollectedData,
  getVoiceUrgencyConfirmationFromCollectedData,
  mergeLockedVoiceAddressState,
  mergeLockedVoiceNameState,
  parseVoiceAddressState,
  parseVoiceNameState,
  type VoiceAddressState,
  type VoiceComfortRisk,
  type VoiceFieldConfirmation,
  type VoiceListeningWindow,
  type VoiceNameState,
  type VoiceSmsHandoff,
  type VoiceSmsPhoneState,
  type VoiceUrgencyConfirmation,
} from "../conversations/voice-conversation-state.codec";

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
export class VoiceConversationStateService {
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
