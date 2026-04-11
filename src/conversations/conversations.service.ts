import { randomUUID } from "crypto";
import { Injectable } from "@nestjs/common";
import {
  ConversationChannel,
  ConversationJobRelation,
  ConversationStatus,
  type Conversation,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { LoggingService } from "../logging/logging.service";
import {
  buildAiRouteState,
  type AiRouteIntent,
} from "../ai/routing/ai-route-state";
import { ConversationsRepository } from "./conversations.repository";
import { ConversationCustomerResolver } from "./conversation-customer-resolver";
import {
  getDefaultVoiceAddressState,
  getDefaultVoiceNameState,
  getDefaultVoiceSmsPhoneState,
  getVoiceAddressStateFromCollectedData,
  getVoiceComfortRiskFromCollectedData,
  getVoiceNameStateFromCollectedData,
  getVoiceSmsHandoffFromCollectedData,
  getVoiceSmsPhoneStateFromCollectedData,
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
} from "./voice-conversation-state.codec";
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
export class ConversationsService {
  private readonly repository: ConversationsRepository;
  private readonly customerResolver: ConversationCustomerResolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
    private readonly loggingService: LoggingService,
  ) {
    this.repository = new ConversationsRepository(this.prisma);
    this.customerResolver = new ConversationCustomerResolver(
      this.repository,
      this.loggingService,
    );
  }

  async ensureConversation(tenantId: string, sessionId: string) {
    const existing = await this.repository.findConversationFirst({
      where: {
        tenantId,
        collectedData: {
          path: ["sessionId"],
          equals: sessionId,
        },
      },
    });

    if (existing) {
      return existing;
    }

    const safeSessionId =
      this.sanitizationService.sanitizeIdentifier(sessionId);
    const safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);

    const placeholderPhone = `unknown-${safeSessionId ?? randomUUID()}`;
    const customer = await this.repository.createCustomer({
      data: {
        id: randomUUID(),
        tenantId: safeTenantId ?? tenantId,
        phone: placeholderPhone,
        fullName: "Unknown Caller",
        aiMetadata: {
          source: "WEBCHAT",
          status: "PROSPECT",
          sessionId,
        } as Prisma.InputJsonValue,
      },
    });

    return this.repository.createConversation({
      data: {
        id: randomUUID(),
        tenantId,
        customerId: customer.id,
        customerTenantId: tenantId,
        channel: ConversationChannel.WEBCHAT,
        status: ConversationStatus.ONGOING,
        currentFSMState: "TRIAGE",
        collectedData: {
          sessionId,
          source: "WEBCHAT",
          address: getDefaultVoiceAddressState(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  async ensureSmsConversation(params: {
    tenantId: string;
    fromNumber: string;
    smsSid?: string;
  }): Promise<{ conversation: Conversation; sessionId: string }> {
    const normalizedFrom = this.sanitizationService.normalizePhoneE164(
      params.fromNumber,
    );
    const customer = await this.customerResolver.resolveSmsCustomer({
      tenantId: params.tenantId,
      normalizedPhone: normalizedFrom,
      smsSid: params.smsSid,
    });

    const existing = await this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        customerId: customer.id,
        channel: ConversationChannel.SMS,
        status: ConversationStatus.ONGOING,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      const current = (existing.collectedData ?? {}) as Record<string, unknown>;
      const sessionId =
        typeof current.sessionId === "string" && current.sessionId.trim()
          ? current.sessionId
          : existing.id;
      const needsSessionId = sessionId !== current.sessionId;
      const needsFrom = normalizedFrom && current.smsFrom !== normalizedFrom;
      const needsSid = params.smsSid && existing.twilioSmsSid !== params.smsSid;
      if (needsSessionId || needsFrom || needsSid) {
        const merged: Prisma.InputJsonValue = {
          ...current,
          ...(needsSessionId ? { sessionId } : {}),
          ...(needsFrom ? { smsFrom: normalizedFrom } : {}),
        };
        const updated = await this.repository.updateConversation({
          where: { id: existing.id },
          data: {
            collectedData: merged,
            ...(needsSid ? { twilioSmsSid: params.smsSid } : {}),
            updatedAt: new Date(),
          },
        });
        return { conversation: updated, sessionId };
      }
      return { conversation: existing, sessionId };
    }

    const sessionId = randomUUID();
    const conversation = await this.repository.createConversation({
      data: {
        id: randomUUID(),
        tenantId: params.tenantId,
        customerId: customer.id,
        customerTenantId: params.tenantId,
        channel: ConversationChannel.SMS,
        status: ConversationStatus.ONGOING,
        currentFSMState: "TRIAGE",
        collectedData: {
          source: "SMS",
          sessionId,
          smsFrom: normalizedFrom,
        } as Prisma.InputJsonValue,
        twilioSmsSid: params.smsSid ?? undefined,
      },
    });

    return { conversation, sessionId };
  }

  async ensureVoiceConsentConversation(params: {
    tenantId: string;
    callSid: string;
    requestId?: string;
    callerPhone?: string;
  }) {
    const existing = await this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        twilioCallSid: params.callSid,
      },
    });

    if (existing) {
      const current = (existing.collectedData ?? {}) as {
        voiceConsent?: { granted?: boolean };
        requestId?: string;
        callerPhone?: string;
        name?: VoiceNameState;
        address?: VoiceAddressState;
        smsPhone?: VoiceSmsPhoneState;
      };
      const needsConsent = !current.voiceConsent?.granted;
      const needsRequestId = !current.requestId && params.requestId;
      const normalizedCallerPhone = params.callerPhone
        ? this.sanitizationService.normalizePhoneE164(params.callerPhone)
        : undefined;
      const existingCallerPhone =
        typeof current.callerPhone === "string" ? current.callerPhone : null;
      const needsCallerPhone =
        Boolean(normalizedCallerPhone) && !existingCallerPhone;
      const needsSmsPhone = !current.smsPhone;
      const smsPhoneSeed = existingCallerPhone ?? normalizedCallerPhone ?? null;
      if (needsConsent || needsRequestId || needsCallerPhone || needsSmsPhone) {
        const merged = {
          ...current,
          ...(needsRequestId ? { requestId: params.requestId } : {}),
          ...(needsCallerPhone ? { callerPhone: normalizedCallerPhone } : {}),
          ...(current.name ? {} : { name: getDefaultVoiceNameState() }),
          ...(current.address
            ? {}
            : { address: getDefaultVoiceAddressState() }),
          ...(needsSmsPhone
            ? {
                smsPhone: getDefaultVoiceSmsPhoneState(smsPhoneSeed),
              }
            : {}),
          ...(needsConsent
            ? {
                voiceConsent: {
                  granted: true,
                  method: "implied",
                  timestamp: new Date().toISOString(),
                  callSid: params.callSid,
                },
              }
            : {}),
        } as Prisma.InputJsonValue;
        return this.repository.updateConversation({
          where: { id: existing.id },
          data: { collectedData: merged, updatedAt: new Date() },
        });
      }
      return existing;
    }

    const normalizedCallerPhone = params.callerPhone
      ? this.sanitizationService.normalizePhoneE164(params.callerPhone)
      : undefined;
    const customer = await this.customerResolver.resolveVoiceCustomer({
      tenantId: params.tenantId,
      callSid: params.callSid,
      normalizedPhone: normalizedCallerPhone,
    });

    return this.repository.createConversation({
      data: {
        id: randomUUID(),
        tenantId: params.tenantId,
        customerId: customer.id,
        customerTenantId: params.tenantId,
        channel: ConversationChannel.VOICE,
        status: ConversationStatus.ONGOING,
        currentFSMState: "TRIAGE",
        collectedData: {
          source: "VOICE",
          requestId: params.requestId,
          callerPhone: normalizedCallerPhone,
          smsPhone: getDefaultVoiceSmsPhoneState(normalizedCallerPhone ?? null),
          name: getDefaultVoiceNameState(),
          address: getDefaultVoiceAddressState(),
          voiceConsent: {
            granted: true,
            method: "implied",
            timestamp: new Date().toISOString(),
            callSid: params.callSid,
          },
        } as Prisma.InputJsonValue,
        twilioCallSid: params.callSid,
      },
    });
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
    const existing = this.getVoiceComfortRisk(current as Prisma.JsonValue);
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
    const existing = this.getVoiceUrgencyConfirmation(
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

  async completeVoiceConversationByCallSid(params: {
    tenantId: string;
    callSid: string;
    source: "stop" | "disconnect" | "forced_hangup" | "unknown";
    endedAt?: Date;
    hangupRequestedAt?: string | null;
    hangupToEndMs?: number | null;
  }) {
    const conversation = await this.repository.findConversationFirst({
      where: {
        tenantId: params.tenantId,
        twilioCallSid: params.callSid,
      },
      select: { id: true, status: true, endedAt: true, collectedData: true },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<
      string,
      unknown
    >;
    const lifecycleCurrent =
      current.voiceLifecycle && typeof current.voiceLifecycle === "object"
        ? (current.voiceLifecycle as Record<string, unknown>)
        : {};
    const computedEndedAt = params.endedAt ?? new Date();
    const endedAt = conversation.endedAt ?? computedEndedAt;
    const inferredStatus =
      params.source === "disconnect" && !params.hangupRequestedAt
        ? ConversationStatus.ABANDONED
        : ConversationStatus.COMPLETED;
    const status =
      conversation.status === ConversationStatus.ONGOING
        ? inferredStatus
        : conversation.status;
    const lifecycleNext: Prisma.InputJsonValue = {
      ...lifecycleCurrent,
      endSource: params.source,
      endedAt: endedAt.toISOString(),
      hangupRequestedAt:
        params.hangupRequestedAt ??
        (typeof lifecycleCurrent.hangupRequestedAt === "string"
          ? lifecycleCurrent.hangupRequestedAt
          : null),
      hangupToEndMs:
        typeof params.hangupToEndMs === "number"
          ? params.hangupToEndMs
          : typeof lifecycleCurrent.hangupToEndMs === "number"
            ? lifecycleCurrent.hangupToEndMs
            : null,
      updatedAt: new Date().toISOString(),
    };
    const merged: Prisma.InputJsonValue = {
      ...current,
      voiceLifecycle: lifecycleNext,
    };

    return this.repository.updateConversation({
      where: { id: conversation.id },
      data: {
        status,
        endedAt,
        collectedData: merged,
        updatedAt: new Date(),
      },
      select: { id: true, status: true, endedAt: true, collectedData: true },
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

  async linkJobToConversation(params: {
    tenantId: string;
    conversationId: string;
    jobId: string;
    relationType?: ConversationJobRelation;
  }) {
    return this.repository.createConversationJobLinkOrNullOnConflict({
      data: {
        id: randomUUID(),
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        conversationTenantId: params.tenantId,
        jobId: params.jobId,
        jobTenantId: params.tenantId,
        relationType:
          params.relationType ?? ConversationJobRelation.CREATED_FROM,
      },
    });
  }
}
