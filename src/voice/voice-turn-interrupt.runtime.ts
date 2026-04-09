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

type SlowDownPolicy = {
  isSlowDownRequest: (transcript: string) => boolean;
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
  buildTakeYourTimeTwiml: (
    field: "name" | "address" | "sms_phone",
    strategy?: CsrStrategy,
  ) => string;
  replyWithTwiml: (res: Response | undefined, twiml: string) => Promise<string>;
  buildSayGatherTwiml: (message: string) => string;
};

type InterruptPolicy = {
  isHangupRequest: (transcript: string) => boolean;
  clearIssuePromptAttempts: (callSid: string) => void;
  replyWithTwiml: (res: Response | undefined, twiml: string) => Promise<string>;
  buildTwiml: (message: string) => string;
  isHumanTransferRequest: (transcript: string) => boolean;
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
  buildCallbackOfferTwiml: (strategy?: CsrStrategy) => string;
  isSmsDifferentNumberRequest: (transcript: string) => boolean;
  updateVoiceSmsHandoff: (params: {
    tenantId: string;
    conversationId: string;
    handoff: {
      reason: string;
      messageOverride: string | null;
      createdAt: string;
    };
  }) => Promise<{ id: string; collectedData: Prisma.JsonValue } | null>;
  updateVoiceSmsPhoneState: (params: {
    tenantId: string;
    conversationId: string;
    phoneState: VoiceSmsPhoneState;
  }) => Promise<{ id: string; collectedData: Prisma.JsonValue } | null>;
  buildAskSmsNumberTwiml: (strategy?: CsrStrategy) => string;
};

type TurnBranchContinue = { kind: "continue" };
type TurnBranchExit = { kind: "exit"; value: string };
export type TurnBranchResult = TurnBranchContinue | TurnBranchExit;

export class VoiceTurnInterruptRuntime {
  constructor(
    private readonly slowDownPolicy: SlowDownPolicy,
    private readonly interruptPolicy: InterruptPolicy,
  ) {}

  async handleSlowDown(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    currentEventId: string;
    normalizedSpeech: string;
    expectedField: VoiceExpectedField | null;
    strategy?: CsrStrategy;
  }): Promise<TurnBranchResult> {
    if (!this.slowDownPolicy.isSlowDownRequest(params.normalizedSpeech)) {
      return { kind: "continue" };
    }
    if (params.expectedField === "name") {
      return {
        kind: "exit",
        value: await this.slowDownPolicy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "name",
          sourceEventId: params.currentEventId,
          twiml: this.slowDownPolicy.buildTakeYourTimeTwiml(
            "name",
            params.strategy,
          ),
        }),
      };
    }
    if (params.expectedField === "address") {
      return {
        kind: "exit",
        value: await this.slowDownPolicy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "address",
          sourceEventId: params.currentEventId,
          twiml: this.slowDownPolicy.buildTakeYourTimeTwiml(
            "address",
            params.strategy,
          ),
        }),
      };
    }
    if (params.expectedField === "sms_phone") {
      return {
        kind: "exit",
        value: await this.slowDownPolicy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "sms_phone",
          sourceEventId: params.currentEventId,
          twiml: this.slowDownPolicy.buildTakeYourTimeTwiml(
            "sms_phone",
            params.strategy,
          ),
        }),
      };
    }
    return {
      kind: "exit",
      value: await this.slowDownPolicy.replyWithTwiml(
        params.res,
        this.slowDownPolicy.buildSayGatherTwiml(
          "Sure—take your time. How can I help?",
        ),
      ),
    };
  }

  async handleInterrupts(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    currentEventId: string;
    normalizedSpeech: string;
    strategy?: CsrStrategy;
    phoneState: VoiceSmsPhoneState;
  }): Promise<TurnBranchResult> {
    if (this.interruptPolicy.isHangupRequest(params.normalizedSpeech)) {
      this.interruptPolicy.clearIssuePromptAttempts(params.callSid);
      return {
        kind: "exit",
        value: await this.interruptPolicy.replyWithTwiml(
          params.res,
          this.interruptPolicy.buildTwiml(
            "No problem. If you need anything later, call us back.",
          ),
        ),
      };
    }

    if (this.interruptPolicy.isHumanTransferRequest(params.normalizedSpeech)) {
      return {
        kind: "exit",
        value: await this.interruptPolicy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "confirmation",
          targetField: "callback",
          sourceEventId: params.currentEventId,
          twiml: this.interruptPolicy.buildCallbackOfferTwiml(params.strategy),
        }),
      };
    }

    if (this.interruptPolicy.isSmsDifferentNumberRequest(params.normalizedSpeech)) {
      await this.interruptPolicy.updateVoiceSmsHandoff({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        handoff: {
          reason: "sms_number_change_requested",
          messageOverride: null,
          createdAt: new Date().toISOString(),
        },
      });
      await this.interruptPolicy.updateVoiceSmsPhoneState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        phoneState: {
          ...params.phoneState,
          confirmed: false,
          confirmedAt: null,
          attemptCount: 0,
          lastPromptedAt: new Date().toISOString(),
        },
      });
      return {
        kind: "exit",
        value: await this.interruptPolicy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "sms_phone",
          sourceEventId: params.currentEventId,
          twiml: this.interruptPolicy.buildAskSmsNumberTwiml(params.strategy),
        }),
      };
    }

    return { kind: "continue" };
  }
}
