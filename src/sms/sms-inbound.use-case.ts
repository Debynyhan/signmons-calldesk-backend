import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { validateRequest } from "twilio";
import { CommunicationChannel } from "@prisma/client";
import appConfig, { type AppConfig } from "../config/app.config";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { ConversationLifecycleService } from "../conversations/conversation-lifecycle.service";
import { ConversationsService } from "../conversations/conversations.service";
import { AiService } from "../ai/ai.service";
import { LoggingService } from "../logging/logging.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { VoiceConversationStateService } from "../voice/voice-conversation-state.service";
import {
  getRequestContext,
  setRequestContextData,
} from "../common/context/request-context";
import { ConfirmFieldDto } from "./dto/confirm-field.dto";
import { SmsService } from "./sms.service";

@Injectable()
export class SmsInboundUseCase {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    private readonly conversationLifecycleService: ConversationLifecycleService,
    private readonly conversationsService: ConversationsService,
    private readonly voiceConversationStateService: VoiceConversationStateService,
    private readonly aiService: AiService,
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
      await this.voiceConversationStateService.promoteNameFromSms({
        tenantId,
        conversationId: dto.conversationId,
        value: sanitizedValue,
        sourceEventId,
      });
    } else {
      await this.voiceConversationStateService.promoteAddressFromSms({
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
    this.verifySignature(req);

    const toNumber = this.extractToNumber(req);
    const fromNumber = this.extractFromNumber(req);
    const messageBody = this.extractMessageBody(req);
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

    const smsSid = this.extractSmsSid(req);
    if (smsSid) {
      const existing = await this.conversationsService.getConversationBySmsSid({
        tenantId: tenant.id,
        smsSid,
      });
      if (existing) {
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

  private extractFromNumber(req: Request): string | null {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const from = typeof body.From === "string" ? body.From.trim() : "";
    const normalized = this.sanitizationService.normalizePhoneE164(from);
    return normalized || null;
  }

  private extractToNumber(req: Request): string | null {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const to = typeof body.To === "string" ? body.To.trim() : "";
    const normalized = this.sanitizationService.normalizePhoneE164(to);
    return normalized || null;
  }

  private extractSmsSid(req: Request): string | null {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sid =
      typeof body.SmsSid === "string"
        ? body.SmsSid.trim()
        : typeof body.MessageSid === "string"
          ? body.MessageSid.trim()
          : "";
    return sid || null;
  }

  private extractMessageBody(req: Request): string | null {
    const body = (req.body ?? {}) as Record<string, unknown>;
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

  private shouldVerifySignature(): boolean {
    return (
      this.config.environment === "production" &&
      this.config.twilioSignatureCheck
    );
  }

  private verifySignature(req: Request) {
    if (!this.shouldVerifySignature()) {
      return;
    }

    const signature = req.header("x-twilio-signature");
    if (!signature) {
      throw new UnauthorizedException("Missing Twilio signature.");
    }

    const baseUrl = this.config.twilioWebhookBaseUrl;
    if (!baseUrl) {
      throw new UnauthorizedException("Webhook base URL not configured.");
    }

    const url = `${baseUrl.replace(/\/$/, "")}${req.originalUrl}`;
    const params = (req.body ?? {}) as Record<string, unknown>;
    const isValid = validateRequest(
      this.config.twilioAuthToken,
      signature,
      url,
      params,
    );

    if (!isValid) {
      throw new UnauthorizedException("Invalid Twilio signature.");
    }
  }
}
