import { Injectable } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service";
import { LoggingService } from "../logging/logging.service";

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
    private readonly conversationsService: ConversationsService,
    private readonly loggingService: LoggingService,
  ) {}

  async handleExpectedField(params: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    smsHandoff: ReturnType<ConversationsService["getVoiceSmsHandoff"]>;
    phoneState: ReturnType<ConversationsService["getVoiceSmsPhoneState"]>;
    fallbackPhone: string | null;
    isSameNumber: boolean;
    parsedPhone: string | null;
    sourceEventId: string | null;
    loggerContext: string;
  }): Promise<VoiceSmsPhoneExpectedFieldOutcome> {
    if (!params.smsHandoff) {
      await this.conversationsService.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      return { kind: "not_waiting" };
    }

    if (params.isSameNumber && params.fallbackPhone) {
      await this.conversationsService.updateVoiceSmsPhoneState({
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
      await this.conversationsService.clearVoiceSmsHandoff({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      await this.conversationsService.clearVoiceListeningWindow({
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
      await this.conversationsService.updateVoiceSmsPhoneState({
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
      await this.conversationsService.clearVoiceSmsHandoff({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      await this.conversationsService.clearVoiceListeningWindow({
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
      await this.conversationsService.updateVoiceSmsPhoneState({
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
      await this.conversationsService.updateVoiceSmsPhoneState({
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
      await this.conversationsService.clearVoiceSmsHandoff({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      await this.conversationsService.clearVoiceListeningWindow({
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

    await this.conversationsService.clearVoiceSmsHandoff({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    await this.conversationsService.clearVoiceListeningWindow({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    return { kind: "human_fallback" };
  }
}
