import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { ConversationsService } from "../conversations/conversations.service";
import type { CsrStrategy } from "./csr-strategy.selector";

type VoiceExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

type VoiceSmsPhoneState = ReturnType<
  ConversationsService["getVoiceSmsPhoneState"]
>;

type VoiceSmsHandoff = ReturnType<ConversationsService["getVoiceSmsHandoff"]>;

type SmsPhoneOutcome = Awaited<
  ReturnType<
    {
      handleExpectedSmsPhoneField: (params: {
        tenantId: string;
        conversationId: string;
        callSid: string;
        smsHandoff: VoiceSmsHandoff;
        phoneState: VoiceSmsPhoneState;
        fallbackPhone: string | null;
        isSameNumber: boolean;
        parsedPhone: string | null;
        sourceEventId: string | null;
        loggerContext: string;
      }) => Promise<
        | { kind: "not_waiting" }
        | {
            kind: "handoff";
            reason: string;
            messageOverride?: string;
          }
        | { kind: "reprompt"; sourceEventId: string | null }
        | { kind: "human_fallback" }
      >;
    }["handleExpectedSmsPhoneField"]
  >
>;

type ExpectedFieldPolicy = {
  getVoiceSmsHandoff: (collectedData: Prisma.JsonValue | null) => VoiceSmsHandoff;
  getCallerPhoneFromCollectedData: (
    collectedData: Prisma.JsonValue | null,
  ) => string | null;
  normalizeConfirmationUtterance: (value: string) => string;
  isSmsNumberConfirmation: (transcript: string) => boolean;
  extractSmsPhoneCandidate: (transcript: string) => string | null;
  handleExpectedSmsPhoneField: (params: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    smsHandoff: VoiceSmsHandoff;
    phoneState: VoiceSmsPhoneState;
    fallbackPhone: string | null;
    isSameNumber: boolean;
    parsedPhone: string | null;
    sourceEventId: string | null;
    loggerContext: string;
  }) => Promise<SmsPhoneOutcome>;
  replyWithSmsHandoff: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    reason: string;
    messageOverride?: string;
  }) => Promise<string>;
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
    targetField?:
      | "name"
      | "address"
      | "booking"
      | "callback"
      | "comfort_risk"
      | "urgency_confirm";
    sourceEventId: string | null;
    twiml: string;
    timeoutSec?: number;
  }) => Promise<string>;
  buildAskSmsNumberTwiml: (strategy?: CsrStrategy) => string;
  replyWithHumanFallback: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    reason: string;
    messageOverride?: string;
  }) => Promise<string>;
  loggerContext: string;
};

type ExpectedFieldBranchResult =
  | { kind: "continue"; expectedField: VoiceExpectedField | null }
  | { kind: "exit"; value: string };

export class VoiceTurnExpectedFieldRuntime {
  constructor(private readonly policy: ExpectedFieldPolicy) {}

  async handleSmsPhoneExpectedField(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    expectedField: VoiceExpectedField | null;
    phoneState: VoiceSmsPhoneState;
    collectedData: Prisma.JsonValue | null;
    normalizedSpeech: string;
    currentEventId: string | null;
    strategy?: CsrStrategy;
  }): Promise<ExpectedFieldBranchResult> {
    if (params.expectedField !== "sms_phone") {
      return { kind: "continue", expectedField: params.expectedField };
    }

    const smsHandoff = this.policy.getVoiceSmsHandoff(params.collectedData);
    const callerPhone = this.policy.getCallerPhoneFromCollectedData(
      params.collectedData,
    );
    const fallbackPhone = params.phoneState.value ?? callerPhone;
    const normalized = this.policy.normalizeConfirmationUtterance(
      params.normalizedSpeech,
    );
    const smsPhoneOutcome = await this.policy.handleExpectedSmsPhoneField({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      smsHandoff,
      phoneState: params.phoneState,
      fallbackPhone,
      isSameNumber: this.policy.isSmsNumberConfirmation(normalized),
      parsedPhone: this.policy.extractSmsPhoneCandidate(params.normalizedSpeech),
      sourceEventId: params.currentEventId,
      loggerContext: this.policy.loggerContext,
    });

    if (smsPhoneOutcome.kind === "not_waiting") {
      return { kind: "continue", expectedField: null };
    }
    if (smsPhoneOutcome.kind === "handoff") {
      return {
        kind: "exit",
        value: await this.policy.replyWithSmsHandoff({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          reason: smsPhoneOutcome.reason,
          messageOverride: smsPhoneOutcome.messageOverride,
        }),
      };
    }
    if (smsPhoneOutcome.kind === "reprompt") {
      return {
        kind: "exit",
        value: await this.policy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "sms_phone",
          sourceEventId: smsPhoneOutcome.sourceEventId,
          twiml: this.policy.buildAskSmsNumberTwiml(params.strategy),
        }),
      };
    }

    return {
      kind: "exit",
      value: await this.policy.replyWithHumanFallback({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        reason: "sms_phone_missing",
      }),
    };
  }
}
