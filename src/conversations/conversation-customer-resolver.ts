import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { LoggingService } from "../logging/logging.service";
import { ConversationsRepository } from "./conversations.repository";

const LOG_CONTEXT = "ConversationsService";

export class ConversationCustomerResolver {
  constructor(
    private readonly repository: ConversationsRepository,
    private readonly loggingService: LoggingService,
  ) {}

  async resolveVoiceCustomer(params: {
    tenantId: string;
    callSid: string;
    normalizedPhone?: string;
  }) {
    if (params.normalizedPhone) {
      const existing = await this.repository.findCustomerFirst({
        where: { tenantId: params.tenantId, phone: params.normalizedPhone },
      });
      if (existing) {
        return existing;
      }
      try {
        return await this.repository.createCustomer({
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
      } catch {
        this.loggingService.warn(
          {
            event: "voice_customer_create_failed",
            tenantId: params.tenantId,
            phone: params.normalizedPhone,
          },
          LOG_CONTEXT,
        );
        const fallback = await this.repository.findCustomerFirst({
          where: { tenantId: params.tenantId, phone: params.normalizedPhone },
        });
        if (fallback) {
          return fallback;
        }
      }
    }

    const placeholderPhone = `unknown-voice-${params.callSid}`;
    return this.repository.createCustomer({
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

  async resolveSmsCustomer(params: {
    tenantId: string;
    normalizedPhone?: string;
    smsSid?: string;
  }) {
    if (params.normalizedPhone) {
      const existing = await this.repository.findCustomerFirst({
        where: {
          tenantId: params.tenantId,
          phone: params.normalizedPhone,
        },
      });
      if (existing) {
        if (!existing.consentToText) {
          return this.repository.updateCustomer({
            where: { id: existing.id },
            data: {
              consentToText: true,
              consentToTextAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
        return existing;
      }
      try {
        return await this.repository.createCustomer({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            phone: params.normalizedPhone,
            fullName: "Unknown Caller",
            consentToText: true,
            consentToTextAt: new Date(),
            aiMetadata: {
              source: "SMS",
              status: "PROSPECT",
              smsSid: params.smsSid,
            } as Prisma.InputJsonValue,
          },
        });
      } catch {
        this.loggingService.warn(
          {
            event: "sms_customer_create_failed",
            tenantId: params.tenantId,
            phone: params.normalizedPhone,
          },
          LOG_CONTEXT,
        );
        const fallback = await this.repository.findCustomerFirst({
          where: {
            tenantId: params.tenantId,
            phone: params.normalizedPhone,
          },
        });
        if (fallback) {
          return fallback;
        }
      }
    }

    const placeholderPhone = `unknown-sms-${params.smsSid ?? randomUUID()}`;
    return this.repository.createCustomer({
      data: {
        id: randomUUID(),
        tenantId: params.tenantId,
        phone: placeholderPhone,
        fullName: "Unknown Caller",
        consentToText: true,
        consentToTextAt: new Date(),
        aiMetadata: {
          source: "SMS",
          status: "PROSPECT",
          smsSid: params.smsSid,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
