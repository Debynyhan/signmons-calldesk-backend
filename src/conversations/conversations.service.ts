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
      ...(typeof params.confidence === "number"
        ? { lastTranscriptConfidence: params.confidence }
        : {}),
    } as Prisma.InputJsonValue;

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
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
