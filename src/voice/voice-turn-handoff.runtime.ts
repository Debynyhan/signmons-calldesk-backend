import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { CsrStrategy } from "./csr-strategy.selector";
import type { VoiceSmsHandoffPreparationResult } from "./voice-sms-handoff.service";

type VoiceOutcome = "sms_handoff" | "human_fallback" | "no_handoff";

type VoiceTurnHandoffPolicy = {
  clearIssuePromptAttempts: (callSid: string | undefined) => void;
  prepareSmsHandoff: (params: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    reason: string;
    messageOverride?: string;
  }) => Promise<VoiceSmsHandoffPreparationResult>;
  replyWithListeningWindow: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    field:
      | "name"
      | "address"
      | "confirmation"
      | "sms_phone"
      | "booking"
      | "callback"
      | "comfort_risk"
      | "urgency_confirm";
    sourceEventId: string | null;
    twiml: string;
    targetField?:
      | "name"
      | "address"
      | "booking"
      | "callback"
      | "comfort_risk"
      | "urgency_confirm";
    timeoutSec?: number;
  }) => Promise<string>;
  buildSayGatherTwiml: (
    message: string,
    options?: { timeout?: number; bargeIn?: boolean },
  ) => string;
  buildAskSmsNumberTwiml: () => string;
  sendVoiceHandoffIntakeLink: (params: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    toPhone: string;
    displayName: string;
    isEmergency: boolean;
  }) => Promise<void>;
  isUrgencyEmergency: (collectedData: Prisma.JsonValue | null) => boolean;
  resolveSmsHandoffClosingMessage: (params: {
    tenantId: string;
    collectedData: Prisma.JsonValue | null;
    messageOverride?: string;
    callerFirstName?: string;
  }) => Promise<string>;
  buildClosingTwiml: (displayName: string, message: string) => string;
  applyCsrStrategy: (
    strategy: CsrStrategy | undefined,
    message: string,
  ) => string;
  replyWithTwiml: (res: Response | undefined, twiml: string) => Promise<string>;
  buildNoHandoffTwiml: () => string;
  log: (payload: Record<string, unknown>) => void;
  warn: (payload: Record<string, unknown>) => void;
};

export class VoiceTurnHandoffRuntime {
  constructor(private readonly policy: VoiceTurnHandoffPolicy) {}

  isHumanFallbackMessage(message: string): boolean {
    return (
      message.trim() === "Thanks. We'll follow up shortly." ||
      message.trim() === "We'll follow up shortly."
    );
  }

  logVoiceOutcome(params: {
    outcome: VoiceOutcome;
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    reason: string;
  }): void {
    this.policy.log({
      event: "voice.outcome",
      outcome: params.outcome,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });
  }

  async replyWithSmsHandoff(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    reason: string;
    messageOverride?: string;
  }): Promise<string> {
    this.policy.clearIssuePromptAttempts(params.callSid);
    const handoffPreparation = await this.policy.prepareSmsHandoff({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
      messageOverride: params.messageOverride,
    });

    if (handoffPreparation.kind === "prompt_confirm_ani") {
      const lastFour = handoffPreparation.fallbackPhone
        .replace(/\D/g, "")
        .slice(-4);
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "sms_phone",
        sourceEventId: handoffPreparation.sourceEventId,
        twiml: this.policy.buildSayGatherTwiml(
          `I'll send your confirmation to the number ending in ${lastFour}. Does that work, or would you prefer a different number?`,
        ),
      });
    }

    if (handoffPreparation.kind === "prompt_ask_sms_phone") {
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "sms_phone",
        sourceEventId: handoffPreparation.sourceEventId,
        twiml: this.policy.buildAskSmsNumberTwiml(),
      });
    }

    this.logVoiceOutcome({
      outcome: "sms_handoff",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });

    if (handoffPreparation.resolvedSmsPhone) {
      try {
        await this.policy.sendVoiceHandoffIntakeLink({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          toPhone: handoffPreparation.resolvedSmsPhone,
          displayName: params.displayName,
          isEmergency: this.policy.isUrgencyEmergency(
            handoffPreparation.collectedData,
          ),
        });
      } catch (error) {
        this.policy.warn({
          event: "voice.sms_intake_link_send_failed",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const closingMessage = await this.policy.resolveSmsHandoffClosingMessage({
      tenantId: params.tenantId,
      collectedData: handoffPreparation.collectedData,
      messageOverride: params.messageOverride,
    });
    return this.policy.replyWithTwiml(
      params.res,
      this.policy.buildClosingTwiml(params.displayName, closingMessage),
    );
  }

  async replyWithHumanFallback(params: {
    res?: Response;
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    displayName?: string;
    reason: string;
    messageOverride?: string;
  }): Promise<string> {
    this.logVoiceOutcome({
      outcome: "human_fallback",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });
    this.policy.clearIssuePromptAttempts(params.callSid);
    const message = params.messageOverride ?? "We'll follow up shortly.";
    return this.policy.replyWithTwiml(
      params.res,
      this.policy.buildClosingTwiml(params.displayName ?? "", message),
    );
  }

  async replyWithNoHandoff(params: {
    res?: Response;
    reason: string;
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    twimlOverride?: string;
  }): Promise<string> {
    this.logVoiceOutcome({
      outcome: "no_handoff",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });
    this.policy.clearIssuePromptAttempts(params.callSid);
    return this.policy.replyWithTwiml(
      params.res,
      params.twimlOverride ?? this.policy.buildNoHandoffTwiml(),
    );
  }

  async replyWithBookingOffer(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    sourceEventId: string | null;
    message: string;
    strategy?: CsrStrategy;
  }): Promise<string> {
    const bookingMessage = `${params.message} Would you like to book a visit?`
      .replace(/\s+/g, " ")
      .trim();
    return this.policy.replyWithListeningWindow({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      field: "confirmation",
      targetField: "booking",
      sourceEventId: params.sourceEventId,
      twiml: this.policy.buildSayGatherTwiml(
        this.policy.applyCsrStrategy(params.strategy, bookingMessage),
      ),
    });
  }
}
