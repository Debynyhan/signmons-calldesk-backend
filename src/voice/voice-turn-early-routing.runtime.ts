import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { CsrStrategy } from "./csr-strategy.selector";
import { reduceBookingCallbackSlot } from "./intake/voice-booking-callback.reducer";

type VoiceExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

type VoiceNameState = ReturnType<IConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  IConversationsService["getVoiceAddressState"]
>;

type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

type EarlyRoutingPolicy = {
  resolveBinaryUtterance: (transcript: string) => "YES" | "NO" | null;
  isBookingIntent: (transcript: string) => boolean;
  clearVoiceListeningWindow: (params: {
    tenantId: string;
    conversationId: string;
  }) => Promise<void>;
  replyWithTwiml: (res: Response | undefined, twiml: string) => Promise<string>;
  buildSayGatherTwiml: (message: string) => string;
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
  buildBookingPromptTwiml: (strategy?: CsrStrategy) => string;
  replyWithHumanFallback: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid?: string;
    displayName: string;
    reason: string;
    messageOverride?: string;
  }) => Promise<string>;
  buildCallbackOfferTwiml: (strategy?: CsrStrategy) => string;
  handleExpectedUrgencyField: (params: {
    expectedField: "comfort_risk" | "urgency_confirm";
    binaryIntent: "YES" | "NO" | null;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
  }) => Promise<
    | { kind: "answered"; preface: string }
    | { kind: "reprompt" }
    | { kind: "not_applicable" }
  >;
  continueAfterSideQuestionWithIssueRouting: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    sideQuestionReply: string;
    expectedField: VoiceExpectedField | null;
    nameReady: boolean;
    addressReady: boolean;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: Prisma.JsonValue | null;
    currentEventId: string | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }) => Promise<string>;
  buildUrgencyConfirmTwiml: (
    strategy?: CsrStrategy,
    opts?: { callerName?: string | null; issueCandidate?: string | null },
  ) => string;
};

type EarlyRoutingInput = {
  res?: Response;
  tenantId: string;
  conversationId: string;
  callSid: string;
  displayName: string;
  currentEventId: string;
  normalizedSpeech: string;
  expectedField: VoiceExpectedField | null;
  nameReady: boolean;
  addressReady: boolean;
  nameState: VoiceNameState;
  addressState: VoiceAddressState;
  collectedData: Prisma.JsonValue | null;
  strategy?: CsrStrategy;
  timingCollector?: VoiceTurnTimingCollector;
};

type EarlyRoutingContinue = {
  kind: "continue";
  expectedField: VoiceExpectedField | null;
};

type EarlyRoutingExit = {
  kind: "exit";
  value: string;
};

export type EarlyRoutingResult = EarlyRoutingContinue | EarlyRoutingExit;

export class VoiceTurnEarlyRoutingRuntime {
  constructor(private readonly policy: EarlyRoutingPolicy) {}

  async route(params: EarlyRoutingInput): Promise<EarlyRoutingResult> {
    let expectedField = params.expectedField;
    const bookingCallbackAction = reduceBookingCallbackSlot({
      expectedField:
        expectedField === "booking" || expectedField === "callback"
          ? expectedField
          : null,
      binaryIntent: this.policy.resolveBinaryUtterance(params.normalizedSpeech),
      hasBookingIntent: this.policy.isBookingIntent(params.normalizedSpeech),
    });

    if (bookingCallbackAction.type === "CLEAR_AND_CONTINUE") {
      await this.policy.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      expectedField = null;
    } else if (bookingCallbackAction.type === "BOOKING_DECLINED") {
      await this.policy.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      return {
        kind: "exit",
        value: await this.policy.replyWithTwiml(
          params.res,
          this.policy.buildSayGatherTwiml(
            "No problem. Do you have any other questions?",
          ),
        ),
      };
    } else if (bookingCallbackAction.type === "REPROMPT_BOOKING") {
      return {
        kind: "exit",
        value: await this.policy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "confirmation",
          targetField: "booking",
          sourceEventId: params.currentEventId,
          twiml: this.policy.buildBookingPromptTwiml(params.strategy),
        }),
      };
    } else if (bookingCallbackAction.type === "CALLBACK_REQUESTED") {
      await this.policy.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      return {
        kind: "exit",
        value: await this.policy.replyWithHumanFallback({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          reason: "callback_requested",
          messageOverride: "We'll call you back shortly.",
        }),
      };
    } else if (bookingCallbackAction.type === "CALLBACK_DECLINED") {
      await this.policy.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      return {
        kind: "exit",
        value: await this.policy.replyWithTwiml(
          params.res,
          this.policy.buildSayGatherTwiml(
            "No problem. I can keep helping here. How can I help?",
          ),
        ),
      };
    } else if (bookingCallbackAction.type === "REPROMPT_CALLBACK") {
      return {
        kind: "exit",
        value: await this.policy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "confirmation",
          targetField: "callback",
          sourceEventId: params.currentEventId,
          twiml: this.policy.buildCallbackOfferTwiml(params.strategy),
        }),
      };
    }

    if (expectedField === "comfort_risk" || expectedField === "urgency_confirm") {
      const urgencyOutcome = await this.policy.handleExpectedUrgencyField({
        expectedField,
        binaryIntent: this.policy.resolveBinaryUtterance(params.normalizedSpeech),
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sourceEventId: params.currentEventId ?? null,
      });
      if (urgencyOutcome.kind === "answered") {
        return {
          kind: "exit",
          value: await this.policy.continueAfterSideQuestionWithIssueRouting({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            callSid: params.callSid,
            displayName: params.displayName,
            sideQuestionReply: urgencyOutcome.preface,
            expectedField: null,
            nameReady: params.nameReady,
            addressReady: params.addressReady,
            nameState: params.nameState,
            addressState: params.addressState,
            collectedData: params.collectedData,
            currentEventId: params.currentEventId,
            strategy: params.strategy,
            timingCollector: params.timingCollector,
          }),
        };
      }
      if (urgencyOutcome.kind === "reprompt") {
        return {
          kind: "exit",
          value: await this.policy.replyWithListeningWindow({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            field: "confirmation",
            targetField: "urgency_confirm",
            sourceEventId: params.currentEventId,
            twiml: this.policy.buildUrgencyConfirmTwiml(params.strategy),
          }),
        };
      }
    }

    return {
      kind: "continue",
      expectedField,
    };
  }
}
