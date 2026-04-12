import { Injectable } from "@nestjs/common";
import type { IVoiceTurnStep } from "./voice-turn.step.interface";
import type { VoiceTurnRuntimeSet } from "./voice-turn-runtime.types";
import { VoiceTurnPreludeContextFactory } from "./voice-turn-prelude-context.factory";
import { VoiceTurnNameFlowFactory } from "./voice-turn-name-flow.factory";
import { VoiceTurnAddressFlowFactory } from "./voice-turn-address-flow.factory";
import { VoiceTurnTriageHandoffFactory } from "./voice-turn-triage-handoff.factory";
import { VoiceTurnStepFactory } from "./voice-turn-step.factory";

@Injectable()
export class VoiceTurnRuntimeFactory {
  constructor(
    private readonly triageHandoffFactory: VoiceTurnTriageHandoffFactory,
    private readonly preludeContextFactory: VoiceTurnPreludeContextFactory,
    private readonly nameFlowFactory: VoiceTurnNameFlowFactory,
    private readonly addressFlowFactory: VoiceTurnAddressFlowFactory,
    private readonly stepFactory: VoiceTurnStepFactory,
  ) {}

  build(): VoiceTurnRuntimeSet {
    const runtimes = {} as VoiceTurnRuntimeSet;

    // Build high-fanout shared runtimes first (handoff + side-question), then core turn phases.
    this.triageHandoffFactory.configure(runtimes);
    this.preludeContextFactory.configure(runtimes);
    this.nameFlowFactory.configure(runtimes);
    this.addressFlowFactory.configure(runtimes);

    return runtimes;
  }

  buildSteps(): IVoiceTurnStep[] {
    return this.stepFactory.build(this.build());
  }
}
