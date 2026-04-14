import type { Response } from "express";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { CsrStrategy } from "./csr-strategy.selector";

type VoiceListeningField =
  | "name"
  | "address"
  | "confirmation"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

type VoiceAddressState = ReturnType<
  IConversationsService["getVoiceAddressState"]
>;

type TenantFeeConfig = {
  serviceFee: number | null;
  emergencyFee: number | null;
  creditWindowHours: number;
};

type SideQuestionHelperPolicy = {
  normalizeWhitespace: (value: string) => string;
  stripConfirmationPrefix: (value: string) => string;
  isLikelyQuestion: (value: string) => boolean;
  getTenantFeePolicySafe: (tenantId: string) => Promise<unknown | null>;
  getTenantFeeConfig: (policy: unknown | null) => TenantFeeConfig;
  formatFeeAmount: (value: number) => string;
  getTenantDisplayNameById: (tenantId: string) => Promise<string | null>;
  buildAskNameTwiml: (strategy?: CsrStrategy) => string;
  prependPrefaceToGatherTwiml: (preface: string, twiml: string) => string;
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
  buildAddressPromptForState: (
    addressState: VoiceAddressState,
    strategy?: CsrStrategy,
  ) => string;
  buildAskSmsNumberTwiml: (strategy?: CsrStrategy) => string;
  buildBookingPromptTwiml: (strategy?: CsrStrategy) => string;
  buildCallbackOfferTwiml: (strategy?: CsrStrategy) => string;
};

export class VoiceTurnSideQuestionHelperRuntime {
  constructor(private readonly policy: SideQuestionHelperPolicy) {}

  async buildSideQuestionReply(
    tenantId: string,
    transcript: string,
  ): Promise<string | null> {
    const cleaned = this.policy.normalizeWhitespace(transcript);
    const stripped = this.policy.stripConfirmationPrefix(cleaned);
    if (!stripped) {
      return null;
    }
    const normalized = stripped.toLowerCase();

    if (
      /(say yes to what|yes to what|what (are|am) you asking|what are you asking for|what do you need|what is this for)/.test(
        normalized,
      )
    ) {
      return "I'm confirming your details so we can send the right technician.";
    }

    if (
      /(i was speaking to you|talking to you|speaking to you)/.test(normalized)
    ) {
      return "I'm right here to help. I just need a couple of quick details.";
    }

    if (/(how are you|how you doing|how's it going)/.test(normalized)) {
      return "I'm doing well, thanks for asking.";
    }

    if (!this.policy.isLikelyQuestion(normalized)) {
      return null;
    }

    if (/(fee|cost|price|charge|diagnostic)/.test(normalized)) {
      const feePolicy = await this.policy.getTenantFeePolicySafe(tenantId);
      const { serviceFee, creditWindowHours } =
        this.policy.getTenantFeeConfig(feePolicy);
      const creditWindowLabel =
        creditWindowHours === 1 ? "1 hour" : `${creditWindowHours} hours`;
      return typeof serviceFee === "number"
        ? `The service fee is ${this.policy.formatFeeAmount(
            serviceFee,
          )}, and it's credited toward repairs if you approve within ${creditWindowLabel}.`
        : `A service fee applies, and it's credited toward repairs if you approve within ${creditWindowLabel}.`;
    }

    if (
      /(do you|do you guys|can you|will you)\s+(come|send|dispatch|service|work on|handle|repair|fix|check|look at|look over|check out|take a look)/.test(
        normalized,
      )
    ) {
      return "Yes, we can help with that.";
    }

    if (
      /(when|availability|available|can you come|how soon)/.test(normalized)
    ) {
      return "We can check availability once I have your address.";
    }

    if (
      /(who (are|am) i speaking with|who is this|what's your name)/.test(
        normalized,
      )
    ) {
      const displayName = await this.policy.getTenantDisplayNameById(tenantId);
      if (displayName) {
        return `You're speaking with the dispatcher at ${displayName}.`;
      }
      return "You're speaking with the dispatcher.";
    }

    return "I can help with that. Let me grab a couple quick details.";
  }

  async replyWithSideQuestionAndContinue(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sideQuestionReply: string;
    expectedField: VoiceListeningField | null;
    nameReady: boolean;
    addressReady: boolean;
    addressState: VoiceAddressState;
    currentEventId: string | null;
    strategy?: CsrStrategy;
  }): Promise<string | null> {
    const preface = params.sideQuestionReply.trim();
    if (!preface) {
      return null;
    }

    if (
      !params.nameReady &&
      (!params.expectedField || params.expectedField === "name")
    ) {
      const baseTwiml = this.policy.buildAskNameTwiml(params.strategy);
      const twiml = this.policy.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "name",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    if (
      !params.addressReady &&
      (!params.expectedField || params.expectedField === "address")
    ) {
      const baseTwiml = this.policy.buildAddressPromptForState(
        params.addressState,
        params.strategy,
      );
      const twiml = this.policy.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "address",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    if (params.expectedField === "sms_phone") {
      const baseTwiml = this.policy.buildAskSmsNumberTwiml(params.strategy);
      const twiml = this.policy.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "sms_phone",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    if (params.expectedField === "booking") {
      const baseTwiml = this.policy.buildBookingPromptTwiml(params.strategy);
      const twiml = this.policy.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "confirmation",
        targetField: "booking",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    if (params.expectedField === "callback") {
      const baseTwiml = this.policy.buildCallbackOfferTwiml(params.strategy);
      const twiml = this.policy.prependPrefaceToGatherTwiml(preface, baseTwiml);
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "confirmation",
        targetField: "callback",
        sourceEventId: params.currentEventId,
        twiml,
      });
    }

    return null;
  }
}
