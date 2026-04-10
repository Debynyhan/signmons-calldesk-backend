import type { Response } from "express";
import type { ConversationsService } from "../conversations/conversations.service";
import type { CsrStrategy } from "./csr-strategy.selector";
import * as voiceAddressCandidatePolicy from "./intake/voice-address-candidate.policy";

type VoiceNameState = ReturnType<ConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  ConversationsService["getVoiceAddressState"]
>;
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

type AddressCompletenessPolicy = {
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
};

export class VoiceTurnAddressCompletenessRuntime {
  constructor(private readonly policy: AddressCompletenessPolicy) {}

  async routeAddressCompleteness(params: {
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
  }): Promise<string | null> {
    const hasStructured = voiceAddressCandidatePolicy.hasStructuredAddressParts(
      params.addressState,
    );
    const missingParts = voiceAddressCandidatePolicy.getAddressMissingParts(
      params.addressState,
    );
    const missingLocality = hasStructured
      ? missingParts.locality
      : Boolean(
          params.candidateForCompleteness &&
            voiceAddressCandidatePolicy.isMissingLocality(
              params.candidateForCompleteness,
            ),
        );
    const missingStreetOrNumber = hasStructured
      ? missingParts.houseNumber || missingParts.street
      : !params.candidateForCompleteness ||
        voiceAddressCandidatePolicy.isIncompleteAddress(
          params.candidateForCompleteness,
        );

    if (missingLocality) {
      return this.policy.handleMissingLocalityPrompt({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        candidate: params.candidateForCompleteness ?? "",
        addressState: params.addressState,
        nameState: params.nameState,
        collectedData: params.collectedData,
        currentEventId: params.currentEventId,
        displayName: params.displayName,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      });
    }
    if (missingStreetOrNumber) {
      return this.policy.replyWithAddressPromptWindow({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sourceEventId: params.currentEventId,
        addressState: params.addressState,
        strategy: params.strategy,
      });
    }
    return null;
  }
}
