import { Injectable } from "@nestjs/common";
import type { Prisma, TenantFeePolicy } from "@prisma/client";
import { getRequestContext } from "../common/context/request-context";
import { ConversationsService } from "../conversations/conversations.service";
import { LoggingService } from "../logging/logging.service";
import { VoiceConversationStateService } from "./voice-conversation-state.service";
import { VoiceHandoffPolicyService } from "./voice-handoff-policy.service";

export type VoiceSmsHandoffPreparationResult =
  | {
      kind: "prompt_confirm_ani";
      sourceEventId: string | null;
      fallbackPhone: string;
    }
  | {
      kind: "prompt_ask_sms_phone";
      sourceEventId: string | null;
    }
  | {
      kind: "ready_to_close";
      resolvedSmsPhone: string | null;
      collectedData: Prisma.JsonValue | null;
    };

@Injectable()
export class VoiceSmsHandoffService {
  private readonly stateServiceDependency?: VoiceConversationStateService;

  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly loggingService: LoggingService,
    private readonly voiceHandoffPolicy: VoiceHandoffPolicyService,
    voiceConversationStateService?: VoiceConversationStateService,
  ) {
    this.stateServiceDependency = voiceConversationStateService;
  }

  private get stateService(): Pick<
    VoiceConversationStateService,
    "updateVoiceSmsPhoneState" | "updateVoiceSmsHandoff" | "clearVoiceSmsHandoff"
  > {
    const legacy = this.conversationsService as Partial<VoiceConversationStateService>;
    if (
      typeof legacy.updateVoiceSmsPhoneState === "function" &&
      typeof legacy.updateVoiceSmsHandoff === "function" &&
      typeof legacy.clearVoiceSmsHandoff === "function"
    ) {
      return legacy as Pick<
        VoiceConversationStateService,
        | "updateVoiceSmsPhoneState"
        | "updateVoiceSmsHandoff"
        | "clearVoiceSmsHandoff"
      >;
    }
    return this.stateServiceDependency as Pick<
      VoiceConversationStateService,
      "updateVoiceSmsPhoneState" | "updateVoiceSmsHandoff" | "clearVoiceSmsHandoff"
    >;
  }

  async prepare(params: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    reason: string;
    messageOverride?: string;
    loggerContext: string;
  }): Promise<VoiceSmsHandoffPreparationResult> {
    const conversation = await this.conversationsService.getConversationById({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    let resolvedSmsPhone: string | null = null;
    const collectedData = conversation?.collectedData ?? null;
    if (collectedData) {
      const phoneState = this.conversationsService.getVoiceSmsPhoneState(collectedData);
      resolvedSmsPhone = phoneState.confirmed ? phoneState.value ?? null : null;
      if (!phoneState.confirmed) {
        const callerPhone = this.getCallerPhoneFromCollectedData(collectedData);
        const fallbackPhone = phoneState.value ?? callerPhone;
        if (fallbackPhone) {
          // Pre-populate ANI/stored number and ask for explicit confirmation first.
          await this.stateService.updateVoiceSmsPhoneState({
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            phoneState: {
              ...phoneState,
              value: fallbackPhone,
              source: phoneState.source ?? "twilio_ani",
              confirmed: false,
              lastPromptedAt: new Date().toISOString(),
            },
          });
          await this.stateService.updateVoiceSmsHandoff({
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            handoff: {
              reason: params.reason,
              messageOverride: params.messageOverride ?? null,
              createdAt: new Date().toISOString(),
            },
          });
          this.loggingService.log(
            {
              event: "voice.sms_phone_ani_confirm_prompted",
              tenantId: params.tenantId,
              conversationId: params.conversationId,
              callSid: params.callSid,
              source: phoneState.source ?? "twilio_ani",
            },
            params.loggerContext,
          );
          return {
            kind: "prompt_confirm_ani",
            sourceEventId: getRequestContext()?.sourceEventId ?? null,
            fallbackPhone,
          };
        }

        await this.stateService.updateVoiceSmsHandoff({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          handoff: {
            reason: params.reason,
            messageOverride: params.messageOverride ?? null,
            createdAt: new Date().toISOString(),
          },
        });
        await this.stateService.updateVoiceSmsPhoneState({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          phoneState: {
            ...phoneState,
            lastPromptedAt: new Date().toISOString(),
          },
        });
        this.loggingService.log(
          {
            event: "voice.sms_phone_prompted",
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            callSid: params.callSid,
          },
          params.loggerContext,
        );
        return {
          kind: "prompt_ask_sms_phone",
          sourceEventId: getRequestContext()?.sourceEventId ?? null,
        };
      }
    }

    await this.stateService.clearVoiceSmsHandoff({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    const smsHandoffStartedAt = new Date().toISOString();
    this.loggingService.log(
      {
        event: "voice.sms_handoff_started",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        sms_handoff_started_at: smsHandoffStartedAt,
      },
      params.loggerContext,
    );
    return {
      kind: "ready_to_close",
      resolvedSmsPhone,
      collectedData,
    };
  }

  buildSmsHandoffMessage(callerFirstName?: string): string {
    const thanks = callerFirstName ? `Thanks, ${callerFirstName}.` : "Perfect.";
    return `${thanks} I'm texting you now to confirm your details. We'll be in touch shortly.`;
  }

  buildSmsHandoffMessageWithFees(params: {
    feePolicy: TenantFeePolicy | null;
    isEmergency: boolean;
    callerFirstName?: string;
  }): string {
    const { serviceFee, emergencyFee, creditWindowHours } =
      this.voiceHandoffPolicy.getTenantFeeConfig(params.feePolicy);
    const creditWindowLabel =
      creditWindowHours === 1 ? "1 hour" : `${creditWindowHours} hours`;
    const serviceLine =
      typeof serviceFee === "number"
        ? `The service fee is ${this.voiceHandoffPolicy.formatFeeAmount(
            serviceFee,
          )}, and it's credited toward repairs if you approve within ${creditWindowLabel}.`
        : `A service fee applies, and it's credited toward repairs if you approve within ${creditWindowLabel}.`;
    const emergencyLine = params.isEmergency
      ? typeof emergencyFee === "number"
        ? `Because this is urgent, there's an additional ${this.voiceHandoffPolicy.formatFeeAmount(
            emergencyFee,
          )} emergency fee. The emergency fee is not credited.`
        : "Because this is urgent, an additional emergency fee applies. The emergency fee is not credited."
      : "";
    const approvalTarget = params.isEmergency ? "the fees" : "the service fee";
    const opener = params.callerFirstName
      ? `Great, ${params.callerFirstName} —`
      : "Great —";
    const smsLine = `I'm texting you now to confirm your details and approve ${approvalTarget}. We'll be in touch shortly.`;
    const feeBlock = emergencyLine ? `${serviceLine} ${emergencyLine}` : serviceLine;
    return `${opener} ${feeBlock} ${smsLine}`.trim();
  }

  buildSmsHandoffMessageForContext(params: {
    feePolicy: TenantFeePolicy | null;
    includeFees: boolean;
    isEmergency: boolean;
    callerFirstName?: string;
  }): string {
    if (!params.includeFees) {
      return this.buildSmsHandoffMessage(params.callerFirstName);
    }
    return this.buildSmsHandoffMessageWithFees({
      feePolicy: params.feePolicy,
      isEmergency: params.isEmergency,
      callerFirstName: params.callerFirstName,
    });
  }

  async resolveSmsHandoffClosingMessage(params: {
    tenantId: string;
    isEmergency: boolean;
    messageOverride?: string;
    callerFirstName?: string;
  }): Promise<string> {
    const feePolicy = await this.voiceHandoffPolicy.getTenantFeePolicySafe(params.tenantId);
    const fallbackMessage = this.buildSmsHandoffMessageWithFees({
      feePolicy,
      isEmergency: params.isEmergency,
      callerFirstName: params.callerFirstName,
    });
    const override = params.messageOverride?.trim();
    if (!override) {
      return fallbackMessage;
    }
    const hasFeeLanguage =
      /\b(service fee|emergency fee|credited toward repairs|fee applies|approve (?:the )?fees|approve (?:the )?service fee)\b/i.test(
        override,
      );
    const hasTextLanguage = /\btext(?:ing)? you\b/i.test(override);
    return hasFeeLanguage && hasTextLanguage ? override : fallbackMessage;
  }

  private getCallerPhoneFromCollectedData(
    collectedData: Prisma.JsonValue | null | undefined,
  ): string | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const data = collectedData as Record<string, unknown>;
    return typeof data.callerPhone === "string" ? data.callerPhone : null;
  }
}
