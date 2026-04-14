import type { Prisma } from "@prisma/client";
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

type VoiceNameState = ReturnType<IConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  IConversationsService["getVoiceAddressState"]
>;
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};
type VoiceUrgencyConfirmation = {
  askedAt: string | null;
  response: "YES" | "NO" | null;
  sourceEventId: string | null;
};

type SideQuestionPolicy = {
  resolveBinaryUtterance: (transcript: string) => "YES" | "NO" | null;
  isFrustrationRequest: (transcript: string) => boolean;
  clearVoiceListeningWindow: (params: {
    tenantId: string;
    conversationId: string;
  }) => Promise<void>;
  replyWithSideQuestionAndContinue: (params: {
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
  }) => Promise<string | null>;
  getVoiceIssueCandidate: (
    collectedData: Prisma.JsonValue | null,
  ) => { value?: string; sourceEventId?: string } | null;
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
  replyWithIssueCaptureRecovery: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: Prisma.JsonValue | null;
    strategy?: CsrStrategy;
    reason: string;
    promptPrefix?: string;
    transcript?: string;
  }) => Promise<string>;
  continueAfterSideQuestionWithIssueRouting: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    sideQuestionReply: string;
    expectedField: VoiceListeningField | null;
    nameReady: boolean;
    addressReady: boolean;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: Prisma.JsonValue | null;
    currentEventId: string | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }) => Promise<string>;
  buildSideQuestionReply: (
    tenantId: string,
    transcript: string,
  ) => Promise<string | null>;
  updateVoiceUrgencyConfirmation: (params: {
    tenantId: string;
    conversationId: string;
    urgencyConfirmation: {
      askedAt: string | null;
      response: "YES" | "NO" | null;
      sourceEventId: string | null;
    };
  }) => Promise<{ id: string; collectedData: Prisma.JsonValue } | null>;
  buildUrgencyConfirmTwiml: (
    strategy?: CsrStrategy,
    context?: {
      callerName?: string | null;
      issueCandidate?: string | null;
    },
  ) => string;
  getVoiceNameCandidate: (nameState: VoiceNameState) => string | null;
};

type TurnBranchContinue = { kind: "continue" };
type TurnBranchExit = { kind: "exit"; value: string };
export type TurnBranchResult = TurnBranchContinue | TurnBranchExit;

export class VoiceTurnSideQuestionRuntime {
  constructor(private readonly policy: SideQuestionPolicy) {}

  async handle(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    normalizedSpeech: string;
    expectedField: VoiceListeningField | null;
    nameReady: boolean;
    addressReady: boolean;
    nameState: VoiceNameState;
    addressState: VoiceAddressState;
    collectedData: Prisma.JsonValue | null;
    currentEventId: string | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
    shouldAskUrgencyConfirm: boolean;
    urgencyConfirmation: VoiceUrgencyConfirmation;
    emergencyIssueContext: string | null;
  }): Promise<TurnBranchResult> {
    const yesNoIntent = this.policy.resolveBinaryUtterance(
      params.normalizedSpeech,
    );
    const shouldHandleLateUrgencyConfirmation =
      !params.expectedField &&
      Boolean(yesNoIntent) &&
      !params.urgencyConfirmation.response &&
      Boolean(params.urgencyConfirmation.askedAt);
    if (shouldHandleLateUrgencyConfirmation) {
      const isYes = yesNoIntent === "YES";
      await this.policy.updateVoiceUrgencyConfirmation({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        urgencyConfirmation: {
          askedAt: new Date().toISOString(),
          response: isYes ? "YES" : "NO",
          sourceEventId: params.currentEventId ?? null,
        },
      });
      await this.policy.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      return {
        kind: "exit",
        value: await this.policy.continueAfterSideQuestionWithIssueRouting({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          sideQuestionReply: isYes
            ? "Thanks. We'll treat this as urgent."
            : "Okay, we'll keep it standard.",
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

    if (this.policy.isFrustrationRequest(params.normalizedSpeech)) {
      const apologyReply = await this.policy.replyWithSideQuestionAndContinue({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sideQuestionReply: "Sorry about that.",
        expectedField: params.expectedField,
        nameReady: params.nameReady,
        addressReady: params.addressReady,
        addressState: params.addressState,
        currentEventId: params.currentEventId,
        strategy: params.strategy,
      });
      if (apologyReply) {
        return { kind: "exit", value: apologyReply };
      }
      const issueForFrustration = this.policy.getVoiceIssueCandidate(
        params.collectedData,
      );
      if (!params.nameReady) {
        const baseTwiml = this.policy.buildAskNameTwiml(params.strategy);
        const twiml = this.policy.prependPrefaceToGatherTwiml(
          "Sorry about that.",
          baseTwiml,
        );
        return {
          kind: "exit",
          value: await this.policy.replyWithListeningWindow({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            field: "name",
            sourceEventId: params.currentEventId,
            twiml,
          }),
        };
      }
      if (!params.addressReady) {
        const baseTwiml = this.policy.buildAddressPromptForState(
          params.addressState,
          params.strategy,
        );
        const twiml = this.policy.prependPrefaceToGatherTwiml(
          "Sorry about that.",
          baseTwiml,
        );
        return {
          kind: "exit",
          value: await this.policy.replyWithListeningWindow({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            field: "address",
            sourceEventId: params.currentEventId,
            twiml,
          }),
        };
      }
      if (!issueForFrustration?.value && params.nameReady && params.addressReady) {
        return {
          kind: "exit",
          value: await this.policy.replyWithIssueCaptureRecovery({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            callSid: params.callSid,
            displayName: params.displayName,
            nameState: params.nameState,
            addressState: params.addressState,
            collectedData: params.collectedData,
            strategy: params.strategy,
            reason: "frustration_missing_issue",
            promptPrefix: "I hear you, and I'm sorry for the repeat.",
            transcript: params.normalizedSpeech,
          }),
        };
      }
      return {
        kind: "exit",
        value: await this.policy.continueAfterSideQuestionWithIssueRouting({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          sideQuestionReply: "I hear you.",
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

    const sideQuestionReply = await this.policy.buildSideQuestionReply(
      params.tenantId,
      params.normalizedSpeech,
    );
    if (sideQuestionReply) {
      if (params.shouldAskUrgencyConfirm) {
        await this.policy.updateVoiceUrgencyConfirmation({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          urgencyConfirmation: {
            askedAt: new Date().toISOString(),
            response: null,
            sourceEventId: params.currentEventId ?? null,
          },
        });
        const baseTwiml = this.policy.buildUrgencyConfirmTwiml(params.strategy, {
          callerName: this.policy.getVoiceNameCandidate(params.nameState),
          issueCandidate: params.emergencyIssueContext,
        });
        const twiml = this.policy.prependPrefaceToGatherTwiml(
          sideQuestionReply,
          baseTwiml,
        );
        return {
          kind: "exit",
          value: await this.policy.replyWithListeningWindow({
            res: params.res,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            field: "confirmation",
            targetField: "urgency_confirm",
            sourceEventId: params.currentEventId,
            twiml,
          }),
        };
      }
      const earlyReply = await this.policy.replyWithSideQuestionAndContinue({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sideQuestionReply,
        expectedField: params.expectedField,
        nameReady: params.nameReady,
        addressReady: params.addressReady,
        addressState: params.addressState,
        currentEventId: params.currentEventId,
        strategy: params.strategy,
      });
      if (earlyReply) {
        return { kind: "exit", value: earlyReply };
      }
    }

    if (params.shouldAskUrgencyConfirm) {
      await this.policy.updateVoiceUrgencyConfirmation({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        urgencyConfirmation: {
          askedAt: new Date().toISOString(),
          response: null,
          sourceEventId: params.currentEventId ?? null,
        },
      });
      return {
        kind: "exit",
        value: await this.policy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "confirmation",
          targetField: "urgency_confirm",
          sourceEventId: params.currentEventId,
          twiml: this.policy.buildUrgencyConfirmTwiml(params.strategy, {
            callerName: this.policy.getVoiceNameCandidate(params.nameState),
            issueCandidate: params.emergencyIssueContext,
          }),
        }),
      };
    }

    return { kind: "continue" };
  }
}
