import { randomUUID } from "crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LoggingService } from "../logging/logging.service";
import { SmsService } from "../sms/sms.service";
import {
  VOICE_NAME_SLOT_SERVICE,
  type IVoiceNameSlot,
} from "../voice/voice-name-slot.service.interface";
import {
  VOICE_ADDRESS_SLOT_SERVICE,
  type IVoiceAddressSlot,
} from "../voice/voice-address-slot.service.interface";
import {
  VOICE_TURN_ORCHESTRATION_SERVICE,
  type IVoiceTurnOrchestration,
} from "../voice/voice-turn-orchestration.service.interface";
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
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly intakeLinkService: IntakeLinkService,
    private readonly intakeFeeCalculator: IntakeFeeCalculatorService,
    private readonly smsService: SmsService,
    @Inject(VOICE_NAME_SLOT_SERVICE)
    private readonly voiceNameSlot: IVoiceNameSlot,
    @Inject(VOICE_ADDRESS_SLOT_SERVICE)
    private readonly voiceAddressSlot: IVoiceAddressSlot,
    @Inject(VOICE_TURN_ORCHESTRATION_SERVICE)
    private readonly voiceTurnOrchestration: IVoiceTurnOrchestration,
  ) {}

  async sendVoiceHandoffIntakeLink(params: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    toPhone: string;
    displayName: string;
    isEmergency: boolean;
  }): Promise<void> {
    if (!this.intakeLinkService.isStripeConfigured()) {
      return;
    }
    if (!this.intakeLinkService.hasPublicIntakeBaseUrl()) {
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
    await this.voiceNameSlot.promoteNameFromSms({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      value: params.fullName,
      sourceEventId,
    });
    await this.voiceAddressSlot.promoteAddressFromSms({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      value: params.address,
      sourceEventId,
    });
    await this.voiceTurnOrchestration.updateVoiceIssueCandidate({
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
      conversation.collectedData &&
      typeof conversation.collectedData === "object"
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
