import { Inject, Injectable } from "@nestjs/common";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import { LoggingService } from "../logging/logging.service";
import { VOICE_SMS_SLOT_SERVICE, type IVoiceSmsSlot } from "./voice-sms-slot.service.interface";
import { VOICE_TURN_ORCHESTRATION_SERVICE, type IVoiceTurnOrchestration } from "./voice-turn-orchestration.service.interface";

export type VoiceSmsPhoneExpectedFieldOutcome =
  | { kind: "not_waiting" }
  | {
      kind: "handoff";
      reason: string;
      messageOverride?: string;
    }
  | {
      kind: "reprompt";
      sourceEventId: string | null;
    }
  | { kind: "human_fallback" };

@Injectable()
export class VoiceSmsPhoneSlotService {
  constructor(
    private readonly loggingService: LoggingService,
    @Inject(VOICE_SMS_SLOT_SERVICE) private readonly voiceSmsSlot: IVoiceSmsSlot,
    @Inject(VOICE_TURN_ORCHESTRATION_SERVICE) private readonly voiceTurnOrchestration: IVoiceTurnOrchestration,
  ) {}

  async handleExpectedField(params: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    smsHandoff: ReturnType<IConversationsService["getVoiceSmsHandoff"]>;
    phoneState: ReturnType<IConversationsService["getVoiceSmsPhoneState"]>;
    fallbackPhone: string | null;
    isSameNumber: boolean;
    parsedPhone: string | null;
    sourceEventId: string | null;
    loggerContext: string;
  }): Promise<VoiceSmsPhoneExpectedFieldOutcome> {
    if (!params.smsHandoff) {
      await this.voiceTurnOrchestration.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      return { kind: "not_waiting" };
    }

    if (params.isSameNumber && params.fallbackPhone) {
      await this.voiceSmsSlot.updateVoiceSmsPhoneState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        phoneState: {
          ...params.phoneState,
          value: params.fallbackPhone,
          source: params.phoneState.source ?? "twilio_ani",
          confirmed: true,
          confirmedAt: new Date().toISOString(),
        },
      });
      await this.voiceSmsSlot.clearVoiceSmsHandoff({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      await this.voiceTurnOrchestration.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      this.loggingService.log(
        {
          event: "voice.sms_phone_confirmed",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          source: "twilio_ani",
        },
        params.loggerContext,
      );
      return {
        kind: "handoff",
        reason: params.smsHandoff.reason,
        messageOverride: params.smsHandoff.messageOverride ?? undefined,
      };
    }

    if (params.parsedPhone) {
      await this.voiceSmsSlot.updateVoiceSmsPhoneState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        phoneState: {
          ...params.phoneState,
          value: params.parsedPhone,
          source: "user_spoken",
          confirmed: true,
          confirmedAt: new Date().toISOString(),
        },
      });
      await this.voiceSmsSlot.clearVoiceSmsHandoff({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      await this.voiceTurnOrchestration.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      this.loggingService.log(
        {
          event: "voice.sms_phone_confirmed",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          source: "user_spoken",
        },
        params.loggerContext,
      );
      return {
        kind: "handoff",
        reason: params.smsHandoff.reason,
        messageOverride: params.smsHandoff.messageOverride ?? undefined,
      };
    }

    const nextAttempt = params.phoneState.attemptCount + 1;
    if (nextAttempt < 2) {
      await this.voiceSmsSlot.updateVoiceSmsPhoneState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        phoneState: {
          ...params.phoneState,
          attemptCount: nextAttempt,
          lastPromptedAt: new Date().toISOString(),
        },
      });
      this.loggingService.warn(
        {
          event: "voice.sms_phone_parse_failed",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          attemptCount: nextAttempt,
        },
        params.loggerContext,
      );
      return {
        kind: "reprompt",
        sourceEventId: params.sourceEventId,
      };
    }

    if (params.fallbackPhone) {
      await this.voiceSmsSlot.updateVoiceSmsPhoneState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        phoneState: {
          ...params.phoneState,
          value: params.fallbackPhone,
          source: params.phoneState.source ?? "twilio_ani",
          confirmed: true,
          confirmedAt: new Date().toISOString(),
        },
      });
      await this.voiceSmsSlot.clearVoiceSmsHandoff({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      await this.voiceTurnOrchestration.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      this.loggingService.warn(
        {
          event: "voice.sms_phone_defaulted",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
        },
        params.loggerContext,
      );
      return {
        kind: "handoff",
        reason: params.smsHandoff.reason,
        messageOverride: params.smsHandoff.messageOverride ?? undefined,
      };
    }

    await this.voiceSmsSlot.clearVoiceSmsHandoff({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    await this.voiceTurnOrchestration.clearVoiceListeningWindow({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    return { kind: "human_fallback" };
  }
}
