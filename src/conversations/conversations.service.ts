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
