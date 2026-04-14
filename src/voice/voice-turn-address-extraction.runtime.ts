import type { Response } from "express";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { CsrStrategy } from "./csr-strategy.selector";
import * as voiceAddressCandidatePolicy from "./intake/voice-address-candidate.policy";
import {
  buildAddressExtractionBaseState,
  buildAddressExtractionCandidateState,
  buildAddressExtractionRetryState,
} from "./intake/voice-address-slot.reducer";

type VoiceNameState = ReturnType<IConversationsService["getVoiceNameState"]>;
type VoiceAddressState = ReturnType<
  IConversationsService["getVoiceAddressState"]
>;
type VoiceTurnTimingCollector = {
  aiMs: number;
  aiCalls?: number;
};

type ExtractedAddressCandidate = {
  address?: string | null;
  houseNumber?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  confidence?: number | null;
};

type AddressExtractionPolicy = {
  sanitizer: {
    sanitizeText(value: string): string;
    normalizeWhitespace(value: string): string;
  };
  voiceAddressMinConfidence: number;
  extractAddressCandidate: (
    tenantId: string,
    transcript: string,
    timingCollector?: VoiceTurnTimingCollector,
  ) => Promise<ExtractedAddressCandidate | null>;
  updateVoiceAddressState: (params: {
    tenantId: string;
    conversationId: string;
    addressState: VoiceAddressState;
  }) => Promise<unknown>;
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
  replyWithAddressConfirmationWindow: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
    candidate: string;
    strategy?: CsrStrategy;
  }) => Promise<string>;
};

export class VoiceTurnAddressExtractionRuntime {
  constructor(private readonly policy: AddressExtractionPolicy) {}

  async handle(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid: string;
    displayName: string;
    currentEventId: string | null;
    normalizedSpeech: string;
    addressState: VoiceAddressState;
    nameState: VoiceNameState;
    collectedData: unknown;
    strategy?: CsrStrategy;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string> {
    const normalizedAddressInput =
      voiceAddressCandidatePolicy.normalizeAddressCandidate(
        params.normalizedSpeech,
        this.policy.sanitizer,
      );
    const fallbackCandidate = voiceAddressCandidatePolicy.stripAddressLeadIn(
      normalizedAddressInput,
      this.policy.sanitizer,
    );
    const usableFallbackCandidate =
      fallbackCandidate &&
      voiceAddressCandidatePolicy.isLikelyAddressCandidate(fallbackCandidate)
        ? fallbackCandidate
        : "";
    const fallbackDerivedParts = usableFallbackCandidate
      ? voiceAddressCandidatePolicy.extractAddressPartsFromCandidate(
          usableFallbackCandidate,
          this.policy.sanitizer,
        )
      : {};
    const directParts: {
      houseNumber?: string | null;
      street?: string | null;
    } = {};
    if (
      params.addressState.street &&
      !params.addressState.houseNumber &&
      voiceAddressCandidatePolicy.isLikelyHouseNumberOnly(normalizedAddressInput)
    ) {
      directParts.houseNumber = normalizedAddressInput;
    }
    if (
      params.addressState.houseNumber &&
      !params.addressState.street &&
      voiceAddressCandidatePolicy.isLikelyStreetOnly(normalizedAddressInput)
    ) {
      directParts.street = normalizedAddressInput;
    }
    const hasDeterministicLineSignal = Boolean(
      fallbackDerivedParts.houseNumber && fallbackDerivedParts.street,
    );
    const hasDeterministicSignal = Boolean(
      hasDeterministicLineSignal ||
        directParts.houseNumber ||
        directParts.street,
    );
    const extracted = hasDeterministicSignal
      ? null
      : await this.policy.extractAddressCandidate(
          params.tenantId,
          params.normalizedSpeech,
          params.timingCollector,
        );
    const normalizedAddress = voiceAddressCandidatePolicy.normalizeAddressCandidate(
      extracted?.address ?? "",
      this.policy.sanitizer,
    );
    const seedCandidate =
      normalizedAddress ||
      usableFallbackCandidate ||
      params.addressState.candidate ||
      null;
    const extractedParts = voiceAddressCandidatePolicy.compactAddressParts({
      houseNumber: voiceAddressCandidatePolicy.normalizeAddressComponent(
        extracted?.houseNumber ?? undefined,
        this.policy.sanitizer,
      ),
      street: voiceAddressCandidatePolicy.normalizeAddressComponent(
        extracted?.street ?? undefined,
        this.policy.sanitizer,
      ),
      city: voiceAddressCandidatePolicy.normalizeAddressComponent(
        extracted?.city ?? undefined,
        this.policy.sanitizer,
      ),
      state: voiceAddressCandidatePolicy.normalizeAddressComponent(
        extracted?.state ?? undefined,
        this.policy.sanitizer,
      ),
      zip: voiceAddressCandidatePolicy.normalizeAddressComponent(
        extracted?.zip ?? undefined,
        this.policy.sanitizer,
      ),
    });
    const derivedParts = seedCandidate
      ? voiceAddressCandidatePolicy.extractAddressPartsFromCandidate(
          seedCandidate,
          this.policy.sanitizer,
        )
      : {};
    const mergedParts = voiceAddressCandidatePolicy.mergeAddressParts(
      params.addressState,
      {
        ...derivedParts,
        ...extractedParts,
        ...directParts,
      },
    );
    const structuredCandidate =
      voiceAddressCandidatePolicy.buildAddressCandidateFromParts(mergedParts);
    const candidateAddress =
      structuredCandidate ||
      normalizedAddress ||
      usableFallbackCandidate ||
      params.addressState.candidate ||
      null;
    const extractedConfidence =
      typeof extracted?.confidence === "number"
        ? extracted.confidence
        : undefined;
    const meetsConfidence =
      typeof extractedConfidence === "number"
        ? extractedConfidence >= this.policy.voiceAddressMinConfidence
        : hasDeterministicSignal || Boolean(usableFallbackCandidate);
    const baseAddressState = buildAddressExtractionBaseState({
      state: params.addressState,
      mergedParts,
      candidate: candidateAddress,
      confidence: extractedConfidence,
      sourceEventId: params.currentEventId,
    });
    const hasStructured =
      voiceAddressCandidatePolicy.hasStructuredAddressParts(baseAddressState);
    const missingParts =
      voiceAddressCandidatePolicy.getAddressMissingParts(baseAddressState);
    const missingStreetOrNumber = hasStructured
      ? missingParts.houseNumber || missingParts.street
      : !candidateAddress ||
        voiceAddressCandidatePolicy.isIncompleteAddress(candidateAddress);
    const missingLocality = hasStructured
      ? missingParts.locality
      : Boolean(
          candidateAddress &&
            voiceAddressCandidatePolicy.isMissingLocality(candidateAddress),
        );

    if (!candidateAddress || missingStreetOrNumber || !meetsConfidence) {
      const retryAddress = buildAddressExtractionRetryState({
        baseState: baseAddressState,
        missingLocality,
      });
      const nextAddressState = retryAddress.state as VoiceAddressState;
      await this.policy.updateVoiceAddressState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        addressState: nextAddressState,
      });
      if (retryAddress.shouldFailClosed) {
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

    const nextAddressState = buildAddressExtractionCandidateState({
      baseState: baseAddressState,
      missingLocality,
    }) as VoiceAddressState;
    await this.policy.updateVoiceAddressState({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      addressState: nextAddressState,
    });
    if (missingLocality) {
      return this.policy.handleMissingLocalityPrompt({
        res: params.res,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        candidate: candidateAddress ?? "",
        addressState: nextAddressState,
        nameState: params.nameState,
        collectedData: params.collectedData,
        currentEventId: params.currentEventId,
        displayName: params.displayName,
        strategy: params.strategy,
        timingCollector: params.timingCollector,
      });
    }
    return this.policy.replyWithAddressConfirmationWindow({
      res: params.res,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      sourceEventId: params.currentEventId,
      candidate: candidateAddress,
      strategy: params.strategy,
    });
  }
}
