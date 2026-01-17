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

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
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
  }) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        twilioCallSid: params.callSid,
      },
    });

    if (existing) {
      const current = existing.collectedData as
        | { voiceConsent?: { granted?: boolean } }
        | null
        | undefined;
      const needsConsent = !current?.voiceConsent?.granted;
      const needsRequestId = !current?.requestId && params.requestId;
      if (needsConsent || needsRequestId) {
        const merged = {
          ...(current ?? {}),
          ...(needsRequestId ? { requestId: params.requestId } : {}),
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

    const placeholderPhone = `unknown-voice-${params.callSid}`;
    const customer = await this.prisma.customer.create({
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
