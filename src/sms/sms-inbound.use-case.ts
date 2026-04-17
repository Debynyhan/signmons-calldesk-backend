import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { CommunicationChannel } from "@prisma/client";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { CONVERSATION_LIFECYCLE_SERVICE, type IConversationLifecycleService } from "../conversations/conversation-lifecycle.service.interface";
import { CONVERSATIONS_SERVICE, type IConversationsService } from "../conversations/conversations.service.interface";
import { AI_SERVICE, type IAiService } from "../ai/ai.service.interface";
import { LoggingService } from "../logging/logging.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { VOICE_NAME_SLOT_SERVICE, type IVoiceNameSlot } from "../voice/voice-name-slot.service.interface";
import { VOICE_ADDRESS_SLOT_SERVICE, type IVoiceAddressSlot } from "../voice/voice-address-slot.service.interface";
import {
  getRequestContext,
  setRequestContextData,
} from "../common/context/request-context";
import { ConfirmFieldDto } from "./dto/confirm-field.dto";
import type { TwilioSmsWebhookDto } from "./dto/twilio-sms-webhook.dto";
import { SmsService } from "./sms.service";

@Injectable()
export class SmsInboundUseCase {
  constructor(
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    @Inject(CONVERSATION_LIFECYCLE_SERVICE) private readonly conversationLifecycleService: IConversationLifecycleService,
    @Inject(CONVERSATIONS_SERVICE) private readonly conversationsService: IConversationsService,
    @Inject(VOICE_NAME_SLOT_SERVICE) private readonly voiceNameSlot: IVoiceNameSlot,
    @Inject(VOICE_ADDRESS_SLOT_SERVICE) private readonly voiceAddressSlot: IVoiceAddressSlot,
    @Inject(AI_SERVICE) private readonly aiService: IAiService,
    private readonly loggingService: LoggingService,
    private readonly sanitizationService: SanitizationService,
    private readonly smsService: SmsService,
  ) {}

  async confirmField(dto: ConfirmFieldDto) {
    const context = getRequestContext();
    const tenantId = context?.tenantId ?? dto.tenantId;
    if (!tenantId) {
      throw new BadRequestException("Missing tenantId.");
    }

    const conversation = await this.conversationsService.getConversationById({
      tenantId,
      conversationId: dto.conversationId,
    });
    if (!conversation) {
      throw new NotFoundException("Conversation not found.");
    }

    const sanitizedValue = this.sanitizationService.normalizeWhitespace(
      this.sanitizationService.sanitizeText(dto.value),
    );
    if (!sanitizedValue) {
      throw new BadRequestException("Invalid value.");
    }

    const sourceEventId =
      dto.sourceEventId?.trim() ?? `sms-${randomUUID()}`;

    if (dto.field === "name") {
      await this.voiceNameSlot.promoteNameFromSms({
        tenantId,
        conversationId: dto.conversationId,
        value: sanitizedValue,
        sourceEventId,
      });
    } else {
      await this.voiceAddressSlot.promoteAddressFromSms({
        tenantId,
        conversationId: dto.conversationId,
        value: sanitizedValue,
        sourceEventId,
      });
    }

    return {
      status: "confirmed",
      field: dto.field,
      conversationId: dto.conversationId,
    };
  }

  async handleInbound(req: Request, res: Response) {
    const smsBody = (req.body ?? {}) as TwilioSmsWebhookDto;
    const toNumber = this.extractToNumber(smsBody);
    const fromNumber = this.extractFromNumber(smsBody);
    const messageBody = this.extractMessageBody(smsBody);
    if (!toNumber || !fromNumber || !messageBody) {
      this.loggingService.warn(
        {
          event: "sms.inbound_missing_fields",
          toNumber,
          fromNumber,
          hasBody: Boolean(messageBody),
        },
        SmsInboundUseCase.name,
      );
      return res.status(204).send();
    }

    const tenant = await this.tenantsService.resolveTenantByPhone(toNumber);
    if (!tenant) {
      this.loggingService.warn(
        {
          event: "sms.inbound_tenant_not_found",
          toNumber,
          fromNumber,
        },
        SmsInboundUseCase.name,
      );
      return res.status(204).send();
    }

    const activeSubscription =
      await this.tenantsService.getActiveTenantSubscription(tenant.id);
    if (!activeSubscription) {
      this.loggingService.warn(
        {
          event: "sms.inbound_subscription_inactive",
          tenantId: tenant.id,
          toNumber,
        },
        SmsInboundUseCase.name,
      );
      return res.status(204).send();
    }

    const smsSid = this.extractSmsSid(smsBody);
    if (smsSid) {
      const existing =
        await this.conversationsService.findConversationTenantBySmsSid({
          smsSid,
        });
      if (existing) {
        if (existing.tenantId !== tenant.id) {
          this.loggingService.warn(
            {
              event: "sms.inbound_tenant_isolation_mismatch",
              smsSid,
              toNumber,
              fromNumber,
              resolvedTenantId: tenant.id,
              conversationTenantId: existing.tenantId,
              conversationId: existing.id,
            },
            SmsInboundUseCase.name,
          );
        }
        return res.status(204).send();
      }
    }

    const { conversation, sessionId } =
      await this.conversationLifecycleService.ensureSmsConversation({
        tenantId: tenant.id,
        fromNumber,
        smsSid: smsSid ?? undefined,
      });
    setRequestContextData({
      tenantId: tenant.id,
      conversationId: conversation.id,
      channel: "SMS",
      sourceEventId: smsSid ?? undefined,
    });

    const aiResult = await this.aiService.triage(
      tenant.id,
      sessionId,
      messageBody,
      {
        conversationId: conversation.id,
        channel: CommunicationChannel.SMS,
      },
    );

    const reply = this.buildSmsReply(aiResult);
    if (reply) {
      await this.smsService.sendMessage({
        to: fromNumber,
        from: toNumber,
        body: reply,
        tenantId: tenant.id,
        conversationId: conversation.id,
      });
    }

    return res.status(204).send();
  }

  private extractFromNumber(body: TwilioSmsWebhookDto): string | null {
    const from = typeof body.From === "string" ? body.From.trim() : "";
    const normalized = this.sanitizationService.normalizePhoneE164(from);
    return normalized || null;
  }

  private extractToNumber(body: TwilioSmsWebhookDto): string | null {
    const to = typeof body.To === "string" ? body.To.trim() : "";
    const normalized = this.sanitizationService.normalizePhoneE164(to);
    return normalized || null;
  }

  private extractSmsSid(body: TwilioSmsWebhookDto): string | null {
    const sid =
      typeof body.SmsSid === "string"
        ? body.SmsSid.trim()
        : typeof body.MessageSid === "string"
          ? body.MessageSid.trim()
          : "";
    return sid || null;
  }

  private extractMessageBody(body: TwilioSmsWebhookDto): string | null {
    const message = typeof body.Body === "string" ? body.Body : "";
    const sanitized = this.sanitizationService.sanitizeText(message);
    return sanitized || null;
  }

  private buildSmsReply(aiResult: unknown): string | null {
    if (
      aiResult &&
      typeof aiResult === "object" &&
      "status" in aiResult
    ) {
      const status = (aiResult as { status?: string }).status;
      if (status === "reply") {
        const reply = (aiResult as { reply?: string }).reply;
        return typeof reply === "string" ? reply : null;
      }
      if (status === "job_created") {
        return "Thanks - you're all set. We'll follow up shortly.";
      }
    }
    return "Thanks - we'll follow up shortly.";
  }
}
