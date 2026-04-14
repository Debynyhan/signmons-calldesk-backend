import type { Response } from "express";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { CsrStrategy } from "./csr-strategy.selector";
import * as voiceAddressCandidatePolicy from "./intake/voice-address-candidate.policy";
import { buildAddressStateFromLocalityMerge } from "./intake/voice-address-slot.reducer";

type VoiceNameState = ReturnType<IConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  IConversationsService["getVoiceAddressState"]
>;
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

type AddressRoutingPolicy = {
  sanitizer: {
    sanitizeText(value: string): string;
    normalizeWhitespace(value: string): string;
  };
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
    timeoutSec?: number;
  }) => Promise<string>;
  buildSayGatherTwiml: (
    message: string,
    options?: { timeout?: number; bargeIn?: boolean },
  ) => string;
  buildAddressPromptForState: (
    addressState: VoiceAddressState,
    strategy?: CsrStrategy,
  ) => string;
  updateVoiceAddressState: (params: {
    tenantId: string;
    conversationId: string;
    addressState: VoiceAddressState;
  }) => Promise<unknown>;
  handleMissingLocalityPrompt: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    candidate: string;
    addressState: VoiceAddressState;
    nameState: VoiceNameState;
    collectedData: unknown;
    currentEventId: string | null;
    displayName: string;
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
  replyWithAddressConfirmationWindow: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
    candidate: string;
    strategy?: CsrStrategy;
  }) => Promise<string>;
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
  handleAddressExistingCandidate: (params: {
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
  }) => Promise<string | null>;
  buildSideQuestionReply: (
    tenantId: string,
    transcript: string,
  ) => Promise<string | null>;
};

export class VoiceTurnAddressRoutingRuntime {
  constructor(private readonly policy: AddressRoutingPolicy) {}

  async handleNotReady(params: {
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
    expectedField: string | null;
    openingAddressPreface: string | null;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string | null> {
    if (params.addressState.status === "FAILED") {
      return this.policy.deferAddressToSmsAuthority({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        displayName: params.displayName,
        currentEventId: params.currentEventId,
        addressState: params.addressState,
        nameState: params.nameState,
        collectedData: params.collectedData,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      });
    }

    if (params.openingAddressPreface && !params.addressState.candidate) {
      return this.policy.replyWithListeningWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        field: "address",
        sourceEventId: params.currentEventId,
        timeoutSec: 8,
        twiml: this.policy.buildSayGatherTwiml(
          `${params.openingAddressPreface} What's the service address?`,
          { timeout: 8 },
        ),
      });
    }

    const duplicateMissing =
      !params.addressState.candidate &&
      params.addressState.sourceEventId === params.currentEventId;
    if (duplicateMissing) {
      return this.policy.replyWithAddressPromptWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sourceEventId: params.currentEventId,
        addressState: params.addressState,
        strategy: params.strategy,
      });
    }

    if (params.addressState.needsLocality && params.addressState.candidate) {
      const normalizedLocality = voiceAddressCandidatePolicy.normalizeAddressCandidate(
        params.normalizedSpeech,
        this.policy.sanitizer,
      );
      const localityParts = voiceAddressCandidatePolicy.parseLocalityParts(
        normalizedLocality,
        this.policy.sanitizer,
      );
      const mergedCandidate = voiceAddressCandidatePolicy.mergeAddressWithLocality(
        params.addressState.candidate,
        normalizedLocality,
      );
      const mergedParts = voiceAddressCandidatePolicy.mergeAddressParts(
        params.addressState,
        localityParts,
      );
      const mergedCandidateFromParts =
        voiceAddressCandidatePolicy.buildAddressCandidateFromParts(mergedParts);
      const nextAddressState = buildAddressStateFromLocalityMerge({
        state: params.addressState,
        mergedParts,
        mergedCandidate:
          mergedCandidate ||
          mergedCandidateFromParts ||
          params.addressState.candidate,
        sourceEventId: params.currentEventId,
      }) as VoiceAddressState;
      await this.policy.updateVoiceAddressState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        addressState: nextAddressState,
      });
      const missingParts =
        voiceAddressCandidatePolicy.getAddressMissingParts(nextAddressState);
      if (missingParts.locality) {
        return this.policy.handleMissingLocalityPrompt({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          candidate: nextAddressState.candidate ?? "",
          addressState: nextAddressState,
          nameState: params.nameState,
          collectedData: params.collectedData,
          currentEventId: params.currentEventId,
          displayName: params.displayName,
          strategy: params.strategy,
          timingCollector: params.timingCollector,
        });
      }
      if (missingParts.houseNumber || missingParts.street) {
        return this.policy.replyWithAddressPromptWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          sourceEventId: params.currentEventId,
          addressState: nextAddressState,
          strategy: params.strategy,
        });
      }
      return this.policy.replyWithAddressConfirmationWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sourceEventId: params.currentEventId,
        candidate: nextAddressState.candidate ?? "",
        strategy: params.strategy,
      });
    }

    const candidateForEvent =
      Boolean(params.addressState.candidate) &&
      params.addressState.sourceEventId === params.currentEventId;
    if (candidateForEvent && params.addressState.candidate) {
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
      return this.policy.replyWithAddressConfirmationWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sourceEventId: params.currentEventId,
        candidate: params.addressState.candidate,
        strategy: params.strategy,
      });
    }

    if (params.addressState.candidate) {
      const existingAddressResponse =
        await this.policy.handleAddressExistingCandidate({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          displayName: params.displayName,
          currentEventId: params.currentEventId,
          normalizedSpeech: params.normalizedSpeech,
          confidence: params.confidence,
          addressState: params.addressState,
          nameState: params.nameState,
          nameReady: params.nameReady,
          collectedData: params.collectedData,
          strategy: params.strategy,
          timingCollector: params.timingCollector,
        });
      if (existingAddressResponse) {
        return existingAddressResponse;
      }
    }

    if (!params.expectedField) {
      const addressQuestionReply = await this.policy.buildSideQuestionReply(
        params.tenantId,
        params.normalizedSpeech,
      );
      if (addressQuestionReply) {
        return this.policy.replyWithListeningWindow({
          res: params.res,
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          field: "address",
          sourceEventId: params.currentEventId,
          timeoutSec: 8,
          twiml: this.policy.buildSayGatherTwiml(
            `${addressQuestionReply} Now, please say the service address.`,
            { timeout: 8 },
          ),
        });
      }
    }

    return null;
  }
}
