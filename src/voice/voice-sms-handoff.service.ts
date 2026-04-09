import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { getRequestContext } from "../common/context/request-context";
import { ConversationsService } from "../conversations/conversations.service";
import { LoggingService } from "../logging/logging.service";

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
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly loggingService: LoggingService,
  ) {}

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
          await this.conversationsService.updateVoiceSmsPhoneState({
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
          await this.conversationsService.updateVoiceSmsHandoff({
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

        await this.conversationsService.updateVoiceSmsHandoff({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          handoff: {
            reason: params.reason,
            messageOverride: params.messageOverride ?? null,
            createdAt: new Date().toISOString(),
          },
        });
        await this.conversationsService.updateVoiceSmsPhoneState({
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

    await this.conversationsService.clearVoiceSmsHandoff({
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
