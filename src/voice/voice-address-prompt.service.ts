import { Injectable } from "@nestjs/common";
import type { VoiceAddressState } from "../conversations/voice-conversation-state.codec";
import { CsrStrategy } from "./csr-strategy.selector";
import * as voiceAddressCandidatePolicy from "./intake/voice-address-candidate.policy";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";

@Injectable()
export class VoiceAddressPromptService {
  constructor(
    private readonly voicePromptComposer: VoicePromptComposerService,
  ) {}

  buildAddressPromptForState(params: {
    addressState: VoiceAddressState;
    strategy?: CsrStrategy;
    applyCsrStrategy: (
      strategy: CsrStrategy | undefined,
      message: string,
    ) => string;
  }): string {
    const { addressState, strategy, applyCsrStrategy } = params;
    if (voiceAddressCandidatePolicy.hasStructuredAddressParts(addressState)) {
      const missing =
        voiceAddressCandidatePolicy.getAddressMissingParts(addressState);
      if (missing.houseNumber && addressState.street) {
        return this.buildAskHouseNumberTwiml(
          strategy,
          addressState.street,
          applyCsrStrategy,
        );
      }
      if (missing.street && addressState.houseNumber) {
        return this.buildAskStreetTwiml(
          strategy,
          addressState.houseNumber,
          applyCsrStrategy,
        );
      }
      if (missing.houseNumber && missing.street) {
        if (!missing.locality) {
          return this.buildAskStreetAddressTwiml(strategy, applyCsrStrategy);
        }
        return this.voicePromptComposer.buildAskAddressTwiml(strategy);
      }
      if (missing.houseNumber || missing.street) {
        return this.voicePromptComposer.buildAskAddressTwiml(strategy);
      }
      if (missing.locality) {
        return this.voicePromptComposer.buildAddressLocalityPromptTwiml(
          strategy,
        );
      }
      if (addressState.candidate) {
        return this.voicePromptComposer.buildAddressConfirmationTwiml(
          addressState.candidate,
          strategy,
        );
      }
      return this.voicePromptComposer.buildAskAddressTwiml(strategy);
    }

    if (addressState.candidate) {
      if (
        voiceAddressCandidatePolicy.isIncompleteAddress(addressState.candidate)
      ) {
        return this.voicePromptComposer.buildIncompleteAddressTwiml(
          addressState.candidate,
          strategy,
        );
      }
      if (
        voiceAddressCandidatePolicy.isMissingLocality(addressState.candidate)
      ) {
        return this.voicePromptComposer.buildAddressLocalityPromptTwiml(
          strategy,
        );
      }
      return this.voicePromptComposer.buildAddressConfirmationTwiml(
        addressState.candidate,
        strategy,
      );
    }
    return this.voicePromptComposer.buildAskAddressTwiml(strategy);
  }

  private buildAskHouseNumberTwiml(
    strategy: CsrStrategy | undefined,
    street: string | null | undefined,
    applyCsrStrategy: (
      strategy: CsrStrategy | undefined,
      message: string,
    ) => string,
  ): string {
    const prefix = street ? `I heard ${this.toTitleCase(street)}. ` : "";
    const core = `${prefix}What's the house number?`;
    return this.voicePromptComposer.buildSayGatherTwiml(
      applyCsrStrategy(strategy, core),
      { timeout: 8 },
    );
  }

  private buildAskStreetTwiml(
    strategy: CsrStrategy | undefined,
    houseNumber: string | null | undefined,
    applyCsrStrategy: (
      strategy: CsrStrategy | undefined,
      message: string,
    ) => string,
  ): string {
    const prefix = houseNumber ? `I heard ${houseNumber}. ` : "";
    const core = `${prefix}What's the street name?`;
    return this.voicePromptComposer.buildSayGatherTwiml(
      applyCsrStrategy(strategy, core),
      { timeout: 8 },
    );
  }

  private buildAskStreetAddressTwiml(
    strategy: CsrStrategy | undefined,
    applyCsrStrategy: (
      strategy: CsrStrategy | undefined,
      message: string,
    ) => string,
  ): string {
    const core = "What's the street address?";
    return this.voicePromptComposer.buildSayGatherTwiml(
      applyCsrStrategy(strategy, core),
      { timeout: 8 },
    );
  }

  private toTitleCase(value: string): string {
    return value
      .split(" ")
      .map((part) => {
        const [head, ...rest] = part.split(/([-'])/);
        return [head, ...rest]
          .map((segment) => {
            if (segment === "-" || segment === "'") {
              return segment;
            }
            if (!segment) {
              return "";
            }
            return `${segment[0].toUpperCase()}${segment.slice(1)}`;
          })
          .join("");
      })
      .join(" ");
  }
}
