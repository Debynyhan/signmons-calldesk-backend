import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { CsrStrategy } from "./csr-strategy.selector";
import * as voiceAddressCandidatePolicy from "./intake/voice-address-candidate.policy";
import {
  buildAddressCorrectionState,
  buildAddressRejectedState,
  buildAddressReplacementState,
} from "./intake/voice-address-slot.reducer";

type VoiceNameState = ReturnType<IConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  IConversationsService["getVoiceAddressState"]
>;
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

type VoiceConfirmationResolution =
  | { outcome: "CONFIRM" }
  | { outcome: "REJECT" }
  | { outcome: "REPLACE_CANDIDATE"; candidate: string | null }
  | { outcome: "UNKNOWN" };

type AddressExistingCandidatePolicy = {
  sanitizer: {
    sanitizeText(value: string): string;
    normalizeWhitespace(value: string): string;
  };
  updateVoiceAddressState: (params: {
    tenantId: string;
    conversationId: string;
    addressState: VoiceAddressState;
  }) => Promise<unknown>;
  replyWithAddressConfirmationWindow: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
    candidate: string;
    strategy?: CsrStrategy;
  }) => Promise<string>;
  isSoftConfirmationEligible: (
    fieldType: "name" | "address",
    candidate: string,
    utterance: string,
    confidence?: number,
  ) => boolean;
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
  buildAddressSoftConfirmationTwiml: (
    candidate: string,
    strategy?: CsrStrategy,
  ) => string;
  resolveConfirmation: (
    utterance: string,
    currentCandidate: string | null,
    fieldType: "name" | "address",
  ) => VoiceConfirmationResolution;
  routeAddressCompleteness: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    currentEventId: string | null;
    addressState: VoiceAddressState;
    candidateForCompleteness: string | null;
    nameState: VoiceNameState;
    collectedData: unknown;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }) => Promise<string | null>;
  handleAddressConfirmedContinuation: (params: {
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
  }) => Promise<string>;
  deferAddressToSmsAuthority: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    currentEventId: string | null;
    addressState: VoiceAddressState;
    nameState: VoiceNameState;
    collectedData: unknown;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }) => Promise<string>;
  replyWithAddressPromptWindow: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
    addressState: VoiceAddressState;
    strategy?: CsrStrategy;
  }) => Promise<string>;
  buildYesNoRepromptTwiml: (strategy?: CsrStrategy) => string;
};

export class VoiceTurnAddressExistingCandidateRuntime {
  constructor(private readonly policy: AddressExistingCandidatePolicy) {}

  async handleAddressExistingCandidate(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    currentEventId: string | null;
    normalizedSpeech: string;
    confidence: number | null | undefined;
    addressState: VoiceAddressState;
    nameState: VoiceNameState;
    nameReady: boolean;
    collectedData: unknown;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string | null> {
    if (!params.addressState.candidate) {
      return null;
    }

    const localityCorrection =
      voiceAddressCandidatePolicy.extractAddressLocalityCorrection(
        params.normalizedSpeech,
        this.policy.sanitizer,
      );
    if (localityCorrection) {
      const mergedParts = voiceAddressCandidatePolicy.mergeAddressParts(
        params.addressState,
        localityCorrection,
      );
      const mergedCandidate =
        voiceAddressCandidatePolicy.buildAddressCandidateFromParts(
          mergedParts,
        ) ||
        voiceAddressCandidatePolicy.mergeAddressWithLocality(
          params.addressState.candidate,
          voiceAddressCandidatePolicy.normalizeAddressCandidate(
            params.normalizedSpeech,
            this.policy.sanitizer,
          ),
        ) ||
        params.addressState.candidate;
      const nextAddressState = buildAddressCorrectionState({
        state: params.addressState,
        mergedParts,
        mergedCandidate,
        sourceEventId: params.currentEventId,
      }) as VoiceAddressState;
      await this.policy.updateVoiceAddressState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        addressState: nextAddressState,
      });
      return this.policy.replyWithAddressConfirmationWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sourceEventId: params.currentEventId,
        candidate: mergedCandidate,
        strategy: params.strategy,
      });
    }

    if (
      this.policy.isSoftConfirmationEligible(
        "address",
        params.addressState.candidate,
        params.normalizedSpeech,
        params.confidence ?? undefined,
      )
    ) {
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "confirmation",
        targetField: "address",
        sourceEventId: params.currentEventId,
        twiml: this.policy.buildAddressSoftConfirmationTwiml(
          params.addressState.candidate,
          params.strategy,
        ),
      });
    }

    const resolution = this.policy.resolveConfirmation(
      params.normalizedSpeech,
      params.addressState.candidate,
      "address",
    );

    if (resolution.outcome === "CONFIRM") {
      const routeResponse = await this.policy.routeAddressCompleteness({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        currentEventId: params.currentEventId,
        addressState: params.addressState,
        candidateForCompleteness: params.addressState.candidate,
        nameState: params.nameState,
        collectedData: params.collectedData,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      });
      if (routeResponse) {
        return routeResponse;
      }
      return this.policy.handleAddressConfirmedContinuation({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        currentEventId: params.currentEventId,
        addressState: params.addressState,
        nameState: params.nameState,
        nameReady: params.nameReady,
        collectedData: (params.collectedData as Prisma.JsonValue | null) ?? null,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      });
    }

    if (resolution.outcome === "REJECT") {
      const rejectedAddress = buildAddressRejectedState({
        state: params.addressState,
        sourceEventId: params.currentEventId,
      });
      const nextAddressState = rejectedAddress.state as VoiceAddressState;
      await this.policy.updateVoiceAddressState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        addressState: nextAddressState,
      });
      if (rejectedAddress.shouldFailClosed) {
        return this.policy.deferAddressToSmsAuthority({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          currentEventId: params.currentEventId,
          addressState: nextAddressState,
          nameState: params.nameState,
          collectedData: params.collectedData,
          strategy: params.strategy,
          timingCollector: params.timingCollector,
        });
      }
      return this.policy.replyWithAddressPromptWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sourceEventId: params.currentEventId,
        addressState: nextAddressState,
        strategy: params.strategy,
      });
    }

    if (resolution.outcome === "REPLACE_CANDIDATE" && resolution.candidate) {
      if (
        voiceAddressCandidatePolicy.isEquivalentAddressCandidate(
          params.addressState.candidate,
          resolution.candidate,
          this.policy.sanitizer,
        )
      ) {
        const routeResponse = await this.policy.routeAddressCompleteness({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          currentEventId: params.currentEventId,
          addressState: params.addressState,
          candidateForCompleteness: params.addressState.candidate,
          nameState: params.nameState,
          collectedData: params.collectedData,
          strategy: params.strategy,
          timingCollector: params.timingCollector,
        });
        if (routeResponse) {
          return routeResponse;
        }
        return this.policy.handleAddressConfirmedContinuation({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          currentEventId: params.currentEventId,
          addressState: params.addressState,
          nameState: params.nameState,
          nameReady: params.nameReady,
          collectedData: (params.collectedData as Prisma.JsonValue | null) ?? null,
          strategy: params.strategy,
          timingCollector: params.timingCollector,
        });
      }

      const replacedAddress = buildAddressReplacementState({
        state: params.addressState,
        replacementCandidate: resolution.candidate,
        sourceEventId: params.currentEventId,
      });
      const nextAddressState = replacedAddress.state as VoiceAddressState;
      await this.policy.updateVoiceAddressState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        addressState: nextAddressState,
      });
      if (replacedAddress.shouldFailClosed) {
        return this.policy.deferAddressToSmsAuthority({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          currentEventId: params.currentEventId,
          addressState: nextAddressState,
          nameState: params.nameState,
          collectedData: params.collectedData,
          strategy: params.strategy,
          timingCollector: params.timingCollector,
        });
      }
      const routeResponse = await this.policy.routeAddressCompleteness({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        currentEventId: params.currentEventId,
        addressState: nextAddressState,
        candidateForCompleteness: resolution.candidate,
        nameState: params.nameState,
        collectedData: params.collectedData,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      });
      if (routeResponse) {
        return routeResponse;
      }
      return this.policy.replyWithAddressConfirmationWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sourceEventId: params.currentEventId,
        candidate: resolution.candidate,
        strategy: params.strategy,
      });
    }

    return this.policy.replyWithListeningWindow({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      field: "confirmation",
      targetField: "address",
      sourceEventId: params.currentEventId,
      twiml: this.policy.buildYesNoRepromptTwiml(params.strategy),
    });
  }
}
