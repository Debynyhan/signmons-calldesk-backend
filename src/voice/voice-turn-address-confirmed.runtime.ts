import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { ConversationsService } from "../conversations/conversations.service";
import type { CsrStrategy } from "./csr-strategy.selector";
import type { VoiceListeningField } from "./voice-turn-context.runtime";
import { buildAddressLockedCandidateState } from "./intake/voice-address-slot.reducer";

type VoiceNameState = ReturnType<ConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  ConversationsService["getVoiceAddressState"]
>;
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

type IssueCandidate = { value?: string; sourceEventId?: string } | null;

type AddressConfirmedContinuationPolicy = {
  updateVoiceAddressState: (params: {
    tenantId: string;
    conversationId: string;
    addressState: VoiceAddressState;
    confirmation?: {
      field: "address";
      value: string;
      confirmedAt: string;
      sourceEventId: string;
      channel: "VOICE";
    };
  }) => Promise<unknown>;
  clearVoiceListeningWindow: (params: {
    tenantId: string;
    conversationId: string;
  }) => Promise<void>;
  getVoiceIssueCandidate: (
    collectedData: Prisma.JsonValue | null,
  ) => IssueCandidate;
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
  buildSayGatherTwiml: (message: string) => string;
  replyWithTwiml: (res: Response | undefined, twiml: string) => Promise<string>;
  log: (payload: Record<string, unknown>) => void;
};

export class VoiceTurnAddressConfirmedRuntime {
  constructor(private readonly policy: AddressConfirmedContinuationPolicy) {}

  async handleAddressConfirmedContinuation(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    currentEventId: string | null;
    addressState: VoiceAddressState;
    nameState: VoiceNameState;
    nameReady: boolean;
    collectedData: Prisma.JsonValue | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string> {
    let nextAddressState = params.addressState;
    const confirmedCandidate = nextAddressState.candidate;

    if (!nextAddressState.locked && confirmedCandidate) {
      const confirmedAt = new Date().toISOString();
      nextAddressState = buildAddressLockedCandidateState({
        state: nextAddressState,
        sourceEventId: params.currentEventId,
      }) as VoiceAddressState;
      await this.policy.updateVoiceAddressState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        addressState: nextAddressState,
        confirmation: {
          field: "address",
          value: confirmedCandidate,
          confirmedAt,
          sourceEventId: params.currentEventId ?? "",
          channel: "VOICE",
        },
      });
      this.policy.log({
        event: "voice.field_confirmed",
        field: "address",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        sourceEventId: params.currentEventId,
      });
    }

    await this.policy.clearVoiceListeningWindow({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });

    const issueCandidate = this.policy.getVoiceIssueCandidate(
      params.collectedData,
    );
    if (issueCandidate?.value) {
      return this.policy.continueAfterSideQuestionWithIssueRouting({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        sideQuestionReply: "Perfect, thanks for confirming that.",
        expectedField: null,
        nameReady: params.nameReady,
        addressReady: true,
        nameState: params.nameState,
        addressState: nextAddressState,
        collectedData: params.collectedData,
        currentEventId: params.currentEventId,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      });
    }

    return this.policy.replyWithTwiml(
      params.res,
      this.policy.buildSayGatherTwiml(
        "Perfect, thanks for confirming that. Now tell me what's been going on with the system.",
      ),
    );
  }
}
