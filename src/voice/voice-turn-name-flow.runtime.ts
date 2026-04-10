import type { ConversationsService } from "../conversations/conversations.service";
import type { Response } from "express";
import type { CsrStrategy } from "./csr-strategy.selector";
import {
  lockNameForAddressProgression as reduceLockNameForAddressProgression,
  markLowConfidenceNameReprompt as reduceMarkLowConfidenceNameReprompt,
  markNameAttemptIfNeeded as reduceMarkNameAttemptIfNeeded,
  markNameSpellPrompted as reduceMarkNameSpellPrompted,
  storeProvisionalNameCandidate as reduceStoreProvisionalNameCandidate,
} from "./intake/voice-name-slot.reducer";

type VoiceNameState = ReturnType<ConversationsService["getVoiceNameState"]>;

type StoreProvisionalNameOptions = {
  lastConfidence?: number | null;
  corrections?: number;
  firstNameSpelled?: string | null;
  spellPromptedAt?: number | null;
  spellPromptedTurnIndex?: number | null;
  spellPromptCount?: number;
};

type VoiceTurnNameFlowPolicy = {
  updateVoiceNameState: (params: {
    tenantId: string;
    conversationId: string;
    nameState: VoiceNameState;
  }) => Promise<unknown>;
  shouldRepromptForLowConfidenceName: (
    state: VoiceNameState,
    candidate: string | null,
  ) => boolean;
  buildNameClarificationPrompt: (candidate: string | null) => string;
  shouldPromptForNameSpelling: (
    state: VoiceNameState,
    candidate: string,
  ) => boolean;
  applyCsrStrategy: (
    strategy: CsrStrategy | undefined,
    message: string,
  ) => string;
  buildSayGatherTwiml: (
    message: string,
    options?: { timeout?: number; bargeIn?: boolean },
  ) => string;
  replyWithListeningWindow: (params: {
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
    timeoutSec?: number;
    targetField?:
      | "name"
      | "address"
      | "booking"
      | "callback"
      | "comfort_risk"
      | "urgency_confirm";
    res?: Response;
  }) => Promise<string>;
  log: (payload: Record<string, unknown>) => void;
};

type NameFlowSessionParams = {
  res?: Response;
  tenantId: string;
  conversationId: string;
  callSid: string;
  currentEventId: string | null;
  strategy?: CsrStrategy;
  turnIndex: number;
  nameState: VoiceNameState;
  existingIssueSummary?: string | null;
  buildSpellNameTwiml: () => string;
};

type NameFlowSession = {
  getNameState: () => VoiceNameState;
  recordNameAttemptIfNeeded: () => Promise<void>;
  replyWithAddressPrompt: (preface?: string) => Promise<string>;
  replyWithNameTwiml: (twiml: string) => Promise<string>;
  storeProvisionalName: (
    candidate: string,
    options?: StoreProvisionalNameOptions,
  ) => Promise<VoiceNameState>;
  promptForNameSpelling: (
    candidate: string,
    baseNameState: VoiceNameState,
  ) => Promise<string>;
  maybePromptForSpelling: (
    candidate: string,
    nextNameState: VoiceNameState,
    issueSummary?: string | null,
  ) => Promise<string>;
  acknowledgeNameAndMoveOn: (
    candidate: string,
    issueSummary?: string | null,
  ) => Promise<string>;
};

export class VoiceTurnNameFlowRuntime {
  constructor(private readonly policy: VoiceTurnNameFlowPolicy) {}

  createSession(params: NameFlowSessionParams): NameFlowSession {
    let workingNameState = params.nameState;

    const buildAddressPrompt = (preface?: string) => {
      const base = "Please say the service address.";
      if (preface && preface.trim()) {
        return this.policy.applyCsrStrategy(
          params.strategy,
          `${preface.trim()} ${base}`,
        );
      }
      return this.policy.applyCsrStrategy(params.strategy, base);
    };

    const lockNameForAddressProgression = async () => {
      const nextNameState = reduceLockNameForAddressProgression({
        state: workingNameState,
        sourceEventId: params.currentEventId,
        nowIso: new Date().toISOString(),
      });
      if (nextNameState === workingNameState) {
        return;
      }
      await this.policy.updateVoiceNameState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        nameState: nextNameState,
      });
      workingNameState = nextNameState;
    };

    const repromptLowConfidenceNameForAddress = async () => {
      const candidate = workingNameState.candidate.value;
      if (
        !this.policy.shouldRepromptForLowConfidenceName(
          workingNameState,
          candidate,
        )
      ) {
        return null;
      }
      const nextNameState = reduceMarkLowConfidenceNameReprompt({
        state: workingNameState,
        candidate,
        turnIndex: params.turnIndex,
        nowMs: Date.now(),
      });
      await this.policy.updateVoiceNameState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        nameState: nextNameState,
      });
      workingNameState = nextNameState;
      this.policy.log({
        event: "nameCapture.lowConfidenceReprompt",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        candidate,
        confidence: workingNameState.lastConfidence ?? null,
        turnIndex: params.turnIndex,
      });
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "name",
        sourceEventId: params.currentEventId,
        twiml: this.policy.buildSayGatherTwiml(
          this.policy.applyCsrStrategy(
            params.strategy,
            this.policy.buildNameClarificationPrompt(candidate),
          ),
        ),
      });
    };

    const replyWithAddressPrompt = async (preface?: string) => {
      const clarification = await repromptLowConfidenceNameForAddress();
      if (clarification) {
        return clarification;
      }
      await lockNameForAddressProgression();
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "address",
        sourceEventId: params.currentEventId,
        timeoutSec: 8,
        twiml: this.policy.buildSayGatherTwiml(buildAddressPrompt(preface), {
          timeout: 8,
        }),
      });
    };

    const recordNameAttemptIfNeeded = async () => {
      const nextNameState = reduceMarkNameAttemptIfNeeded(workingNameState);
      if (nextNameState === workingNameState) {
        return;
      }
      await this.policy.updateVoiceNameState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        nameState: nextNameState,
      });
      workingNameState = nextNameState;
    };

    const replyWithNameTwiml = async (twiml: string) => {
      await recordNameAttemptIfNeeded();
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "name",
        sourceEventId: params.currentEventId,
        twiml,
      });
    };

    const storeProvisionalName = async (
      candidate: string,
      options?: StoreProvisionalNameOptions,
    ) => {
      const nextNameState = reduceStoreProvisionalNameCandidate({
        state: workingNameState,
        candidate,
        sourceEventId: params.currentEventId,
        createdAtIso: new Date().toISOString(),
        options,
      });
      await this.policy.updateVoiceNameState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        nameState: nextNameState,
      });
      workingNameState = nextNameState;
      return nextNameState;
    };

    const promptForNameSpelling = async (
      candidate: string,
      baseNameState: VoiceNameState,
    ) => {
      const promptState = reduceMarkNameSpellPrompted({
        state: baseNameState,
        turnIndex: params.turnIndex,
        nowMs: Date.now(),
      });
      await this.policy.updateVoiceNameState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        nameState: promptState,
      });
      workingNameState = promptState;
      this.policy.log({
        event: "nameCapture.spellPrompted",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        candidate,
        lastConfidence: promptState.lastConfidence ?? null,
        corrections: promptState.corrections ?? 0,
        turnIndex: params.turnIndex,
      });
      return replyWithNameTwiml(params.buildSpellNameTwiml());
    };

    const acknowledgeNameAndMoveOn = async (
      candidate: string,
      issueSummary?: string | null,
    ) => {
      const firstName = candidate.split(" ").filter(Boolean)[0] ?? "";
      const thanks = firstName ? `Thanks, ${firstName}.` : "Thanks.";
      const resolvedIssue = issueSummary ?? params.existingIssueSummary ?? null;
      const trimmedIssue = resolvedIssue?.trim().replace(/[.?!]+$/, "") ?? "";
      const issueAck = trimmedIssue ? `I heard ${trimmedIssue}.` : "";
      const preface = issueAck ? `${thanks} ${issueAck}` : thanks;
      return replyWithAddressPrompt(preface);
    };

    const maybePromptForSpelling = async (
      candidate: string,
      nextNameState: VoiceNameState,
      issueSummary?: string | null,
    ) => {
      if (this.policy.shouldPromptForNameSpelling(nextNameState, candidate)) {
        return promptForNameSpelling(candidate, nextNameState);
      }
      return acknowledgeNameAndMoveOn(candidate, issueSummary ?? null);
    };

    return {
      getNameState: () => workingNameState,
      recordNameAttemptIfNeeded,
      replyWithAddressPrompt,
      replyWithNameTwiml,
      storeProvisionalName,
      promptForNameSpelling,
      maybePromptForSpelling,
      acknowledgeNameAndMoveOn,
    };
  }
}
