import { randomUUID } from "crypto";
import { Injectable } from "@nestjs/common";
import {
  ConversationChannel,
  ConversationJobRelation,
  ConversationStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { LoggingService } from "../logging/logging.service";

type VoiceNameStatus = "MISSING" | "CANDIDATE" | "CONFIRMED";
type VoiceNameCandidate = {
  value: string | null;
  sourceEventId: string | null;
  createdAt: string | null;
};
type VoiceNameConfirmed = {
  value: string | null;
  sourceEventId: string | null;
  confirmedAt: string | null;
};
type VoiceNameState = {
  candidate: VoiceNameCandidate;
  confirmed: VoiceNameConfirmed;
  status: VoiceNameStatus;
  locked: boolean;
  attemptCount: number;
};
type VoiceAddressStatus = "MISSING" | "CANDIDATE" | "CONFIRMED" | "FAILED";
type VoiceAddressState = {
  candidate: string | null;
  confirmed: string | null;
  status: VoiceAddressStatus;
  locked: boolean;
  attemptCount: number;
  confidence?: number;
  sourceEventId?: string | null;
};
type VoiceFieldConfirmation = {
  field: "name" | "address";
  value: string;
  confirmedAt: string;
  sourceEventId: string;
  channel: "VOICE" | "SMS";
};
type VoiceListeningField = "name" | "address" | "confirmation";
type VoiceListeningWindow = {
  field: VoiceListeningField;
  sourceEventId: string | null;
  expiresAt: string;
  targetField?: "name" | "address";
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
    private readonly loggingService: LoggingService,
  ) {}

  async ensureConversation(tenantId: string, sessionId: string) {
    const existing = await this.prisma.conversation.findFirst({
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

    const safeSessionId = this.sanitizationService.sanitizeIdentifier(sessionId);
    const safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);

    const placeholderPhone = `unknown-${safeSessionId ?? randomUUID()}`;
    const customer = await this.prisma.customer.create({
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

    return this.prisma.conversation.create({
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
          address: this.getDefaultAddressState(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  async ensureVoiceConsentConversation(params: {
    tenantId: string;
    callSid: string;
    requestId?: string;
    callerPhone?: string;
  }) {
    const existing = await this.prisma.conversation.findFirst({
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
      };
      const needsConsent = !current.voiceConsent?.granted;
      const needsRequestId = !current.requestId && params.requestId;
      const normalizedCallerPhone = params.callerPhone
        ? this.sanitizationService.normalizePhoneE164(params.callerPhone)
        : undefined;
      const needsCallerPhone =
        Boolean(normalizedCallerPhone) && !current.callerPhone;
      if (needsConsent || needsRequestId || needsCallerPhone) {
        const merged = {
          ...current,
          ...(needsRequestId ? { requestId: params.requestId } : {}),
          ...(needsCallerPhone ? { callerPhone: normalizedCallerPhone } : {}),
          ...(current.name ? {} : { name: this.getDefaultNameState() }),
          ...(current.address ? {} : { address: this.getDefaultAddressState() }),
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
        return this.prisma.conversation.update({
          where: { id: existing.id },
          data: { collectedData: merged, updatedAt: new Date() },
        });
      }
      return existing;
    }

    const normalizedCallerPhone = params.callerPhone
      ? this.sanitizationService.normalizePhoneE164(params.callerPhone)
      : undefined;
    const customer = await this.resolveVoiceCustomer({
      tenantId: params.tenantId,
      callSid: params.callSid,
      normalizedPhone: normalizedCallerPhone,
    });

    return this.prisma.conversation.create({
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
          name: this.getDefaultNameState(),
          address: this.getDefaultAddressState(),
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
    return this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        twilioCallSid: params.callSid,
      },
    });
  }

  async getConversationById(params: { tenantId: string; conversationId: string }) {
    return this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
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

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        twilioCallSid: params.callSid,
      },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<string, unknown>;
    const merged = {
      ...current,
      lastTranscript: normalized,
      lastTranscriptAt: new Date().toISOString(),
      ...(typeof params.confidence === "number"
        ? { lastTranscriptConfidence: params.confidence }
        : {}),
    } as Prisma.InputJsonValue;

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
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
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<string, unknown>;
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

    const updated = await this.prisma.conversation.update({
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
    if (!collectedData || typeof collectedData !== "object") {
      return this.getDefaultNameState();
    }
    const data = collectedData as Record<string, unknown>;
    return this.parseNameState(data.name);
  }

  getVoiceAddressState(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceAddressState {
    if (!collectedData || typeof collectedData !== "object") {
      return this.getDefaultAddressState();
    }
    const data = collectedData as Record<string, unknown>;
    return this.parseAddressState(data.address);
  }

  async updateVoiceNameState(params: {
    tenantId: string;
    conversationId: string;
    nameState: VoiceNameState;
    confirmation?: VoiceFieldConfirmation;
  }) {
    const conversation = await this.prisma.conversation.findFirst({
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
    const currentName = this.parseNameState(current.name);
    const nextName = this.mergeNameState(currentName, params.nameState);
    const confirmations = Array.isArray(current.fieldConfirmations)
      ? [...current.fieldConfirmations]
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

    return this.prisma.conversation.update({
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
    const conversation = await this.prisma.conversation.findFirst({
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
    const currentAddress = this.parseAddressState(current.address);
    const nextAddress = this.mergeAddressState(
      currentAddress,
      params.addressState,
    );
    const confirmations = Array.isArray(current.fieldConfirmations)
      ? [...current.fieldConfirmations]
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

    return this.prisma.conversation.update({
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
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<string, unknown>;
    const merged: Prisma.InputJsonValue = {
      ...current,
      voiceListeningWindow: params.window,
    };

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
      select: { id: true, collectedData: true },
    });
  }

  async clearVoiceListeningWindow(params: {
    tenantId: string;
    conversationId: string;
  }) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<string, unknown>;
    const { voiceListeningWindow: _ignored, ...rest } = current;
    const merged: Prisma.InputJsonValue = { ...rest };

    return this.prisma.conversation.update({
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
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });

    if (!conversation) {
      return null;
    }

    const current = (conversation.collectedData ?? {}) as Record<string, unknown>;
    const merged: Prisma.InputJsonValue = {
      ...current,
      voiceLastEventId: params.eventId,
    };

    return this.prisma.conversation.update({
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
    const conversation = await this.prisma.conversation.findFirst({
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
    const currentName = this.parseNameState(current.name);
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
    const conversation = await this.prisma.conversation.findFirst({
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
    const currentAddress = this.parseAddressState(current.address);
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

  private async resolveVoiceCustomer(params: {
    tenantId: string;
    callSid: string;
    normalizedPhone?: string;
  }) {
    if (params.normalizedPhone) {
      const existing = await this.prisma.customer.findFirst({
        where: { tenantId: params.tenantId, phone: params.normalizedPhone },
      });
      if (existing) {
        return existing;
      }
      try {
        return await this.prisma.customer.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            phone: params.normalizedPhone,
            fullName: "Unknown Caller",
            aiMetadata: {
              source: "VOICE",
              status: "PROSPECT",
              callSid: params.callSid,
            } as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        this.loggingService.warn(
          {
            event: "voice_customer_create_failed",
            tenantId: params.tenantId,
            phone: params.normalizedPhone,
          },
          ConversationsService.name,
        );
        const fallback = await this.prisma.customer.findFirst({
          where: { tenantId: params.tenantId, phone: params.normalizedPhone },
        });
        if (fallback) {
          return fallback;
        }
      }
    }

    const placeholderPhone = `unknown-voice-${params.callSid}`;
    return this.prisma.customer.create({
      data: {
        id: randomUUID(),
        tenantId: params.tenantId,
        phone: placeholderPhone,
        fullName: "Unknown Caller",
        aiMetadata: {
          source: "VOICE",
          status: "PROSPECT",
          callSid: params.callSid,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private getDefaultNameState(): VoiceNameState {
    return {
      candidate: { value: null, sourceEventId: null, createdAt: null },
      confirmed: { value: null, sourceEventId: null, confirmedAt: null },
      status: "MISSING",
      locked: false,
      attemptCount: 0,
    };
  }

  private getDefaultAddressState(): VoiceAddressState {
    return {
      candidate: null,
      confirmed: null,
      status: "MISSING",
      locked: false,
      attemptCount: 0,
      confidence: undefined,
      sourceEventId: null,
    };
  }

  private parseNameState(value: unknown): VoiceNameState {
    const defaults = this.getDefaultNameState();
    if (!value || typeof value !== "object") {
      return defaults;
    }
    const data = value as Partial<VoiceNameState>;
    const candidate = data.candidate ?? defaults.candidate;
    const confirmed = data.confirmed ?? defaults.confirmed;
    const status =
      data.status === "CANDIDATE" || data.status === "CONFIRMED"
        ? data.status
        : "MISSING";
    return {
      candidate: {
        value: typeof candidate.value === "string" ? candidate.value : null,
        sourceEventId:
          typeof candidate.sourceEventId === "string"
            ? candidate.sourceEventId
            : null,
        createdAt:
          typeof candidate.createdAt === "string" ? candidate.createdAt : null,
      },
      confirmed: {
        value: typeof confirmed.value === "string" ? confirmed.value : null,
        sourceEventId:
          typeof confirmed.sourceEventId === "string"
            ? confirmed.sourceEventId
            : null,
        confirmedAt:
          typeof confirmed.confirmedAt === "string"
            ? confirmed.confirmedAt
            : null,
      },
      status,
      locked: Boolean(data.locked),
      attemptCount:
        typeof data.attemptCount === "number" && data.attemptCount >= 0
          ? data.attemptCount
          : 0,
    };
  }

  private parseAddressState(value: unknown): VoiceAddressState {
    const defaults = this.getDefaultAddressState();
    if (!value || typeof value !== "object") {
      return defaults;
    }
    const data = value as Record<string, unknown>;
    const candidateRaw = data.candidate;
    const confirmedRaw = data.confirmed;
    let candidate =
      typeof candidateRaw === "string" ? candidateRaw : defaults.candidate;
    let confirmed =
      typeof confirmedRaw === "string" ? confirmedRaw : defaults.confirmed;
    let sourceEventId =
      typeof data.sourceEventId === "string" ? data.sourceEventId : null;
    const confidence =
      typeof data.confidence === "number" ? data.confidence : undefined;
    if (candidateRaw && typeof candidateRaw === "object") {
      const legacyCandidate = candidateRaw as {
        value?: unknown;
        sourceEventId?: unknown;
      };
      if (typeof legacyCandidate.value === "string") {
        candidate = legacyCandidate.value;
      }
      if (
        typeof legacyCandidate.sourceEventId === "string" &&
        !sourceEventId
      ) {
        sourceEventId = legacyCandidate.sourceEventId;
      }
    }
    if (confirmedRaw && typeof confirmedRaw === "object") {
      const legacyConfirmed = confirmedRaw as {
        value?: unknown;
        sourceEventId?: unknown;
      };
      if (typeof legacyConfirmed.value === "string") {
        confirmed = legacyConfirmed.value;
      }
      if (
        typeof legacyConfirmed.sourceEventId === "string" &&
        !sourceEventId
      ) {
        sourceEventId = legacyConfirmed.sourceEventId;
      }
    }
    const status =
      data.status === "CANDIDATE" ||
      data.status === "CONFIRMED" ||
      data.status === "FAILED"
        ? data.status
        : "MISSING";
    return {
      candidate: candidate ?? null,
      confirmed: confirmed ?? null,
      status,
      locked: Boolean(data.locked),
      attemptCount:
        typeof data.attemptCount === "number" && data.attemptCount >= 0
          ? data.attemptCount
          : 0,
      confidence,
      sourceEventId,
    };
  }

  private mergeNameState(
    current: VoiceNameState,
    next: VoiceNameState,
  ): VoiceNameState {
    if (current.locked && current.confirmed.value) {
      return {
        ...current,
        status: "CONFIRMED",
        locked: true,
      };
    }
    return next;
  }

  private mergeAddressState(
    current: VoiceAddressState,
    next: VoiceAddressState,
  ): VoiceAddressState {
    if (current.locked && current.confirmed) {
      return {
        ...current,
        status: "CONFIRMED",
        locked: true,
      };
    }
    return next;
  }

  async linkJobToConversation(params: {
    tenantId: string;
    conversationId: string;
    jobId: string;
    relationType?: ConversationJobRelation;
  }) {
    try {
      return await this.prisma.conversationJobLink.create({
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
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return null;
      }
      throw error;
    }
  }
}
