import { randomUUID } from "crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import appConfig, { type AppConfig } from "../config/app.config";
import { PrismaService } from "../prisma/prisma.service";
import { LoggingService } from "../logging/logging.service";
import { SmsService } from "../sms/sms.service";
import { VoiceConversationStateService } from "../voice/voice-conversation-state.service";
import { IntakeLinkService } from "./intake-link.service";
import { IntakeFeeCalculatorService } from "./intake-fee-calculator.service";

export type VoiceIntakePaymentState = {
  linkSentAt?: string;
  linkMessageSid?: string | null;
  linkToPhone?: string | null;
  intakeUrl?: string;
  tokenExpiresAt?: string;
  amountCents?: number;
  currency?: string;
  checkoutSessionId?: string;
  checkoutCreatedAt?: string;
};

@Injectable()
export class VoiceIntakeSmsService {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly intakeLinkService: IntakeLinkService,
    private readonly intakeFeeCalculator: IntakeFeeCalculatorService,
    private readonly smsService: SmsService,
    private readonly voiceConversationStateService: VoiceConversationStateService,
  ) {}

  async sendVoiceHandoffIntakeLink(params: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    toPhone: string;
    displayName: string;
    isEmergency: boolean;
  }): Promise<void> {
    if (!this.config.stripeSecretKey) {
      return;
    }
    if (!this.config.smsIntakeBaseUrl && !this.config.twilioWebhookBaseUrl) {
      this.loggingService.warn(
        {
          event: "voice.sms_intake_link_skipped",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          reason: "missing_public_base_url",
        },
        VoiceIntakeSmsService.name,
      );
      return;
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });
    if (!conversation) {
      return;
    }
    const state = this.getVoiceIntakePaymentState(conversation.collectedData);
    if (state?.linkSentAt && state?.intakeUrl) {
      return;
    }

    const tokenData = this.intakeLinkService.createConversationToken({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    const intakeUrl = this.intakeLinkService.buildIntakeUrl(tokenData.token);
    const intakeContext = await this.intakeFeeCalculator.resolveIntakeContext(
      tokenData.token,
    );
    const totalCents = this.intakeFeeCalculator.computeTotalCents(
      intakeContext,
      params.isEmergency,
    );
    const amount = this.intakeFeeCalculator.formatFeeAmount(totalCents);
    const body = `Thanks for calling ${params.displayName}. Confirm your details and pay ${amount} to dispatch: ${intakeUrl}`;

    const messageSid = await this.smsService.sendMessage({
      to: params.toPhone,
      body,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });

    await this.updateVoiceIntakePaymentState({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      next: {
        linkSentAt: new Date().toISOString(),
        linkMessageSid: messageSid ?? null,
        linkToPhone: params.toPhone,
        intakeUrl,
        tokenExpiresAt: tokenData.expiresAt,
        amountCents: totalCents,
        currency: intakeContext.currency.toLowerCase(),
      },
    });

    this.loggingService.log(
      {
        event: "voice.sms_intake_link_sent",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        to: params.toPhone,
        hasMessageSid: Boolean(messageSid),
      },
      VoiceIntakeSmsService.name,
    );
  }

  async persistSmsIntakeFields(params: {
    tenantId: string;
    conversationId: string;
    fullName: string;
    address: string;
    issue: string;
  }): Promise<void> {
    const sourceEventId = `sms-intake-${randomUUID()}`;
    await this.voiceConversationStateService.promoteNameFromSms({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      value: params.fullName,
      sourceEventId,
    });
    await this.voiceConversationStateService.promoteAddressFromSms({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      value: params.address,
      sourceEventId,
    });
    await this.voiceConversationStateService.updateVoiceIssueCandidate({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      issue: {
        value: params.issue,
        sourceEventId,
        createdAt: new Date().toISOString(),
      },
    });
  }

  async updateVoiceIntakePaymentState(params: {
    tenantId: string;
    conversationId: string;
    next: VoiceIntakePaymentState;
  }): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });
    if (!conversation) {
      return;
    }
    const current =
      conversation.collectedData && typeof conversation.collectedData === "object"
        ? (conversation.collectedData as Record<string, unknown>)
        : {};
    const existingState = this.getVoiceIntakePaymentState(
      conversation.collectedData ?? null,
    );
    const merged: Prisma.InputJsonValue = {
      ...current,
      voiceIntakePayment: {
        ...(existingState ?? {}),
        ...params.next,
      },
    };
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
    });
  }

  private getVoiceIntakePaymentState(
    collectedData: Prisma.JsonValue | null,
  ): VoiceIntakePaymentState | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const raw = (collectedData as Record<string, unknown>).voiceIntakePayment;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return raw as VoiceIntakePaymentState;
  }
}
