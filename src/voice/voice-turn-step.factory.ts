import { Injectable, Inject } from "@nestjs/common";
import type { IVoiceTurnStep } from "./voice-turn.step.interface";
import type { VoiceTurnRuntimeSet } from "./voice-turn-runtime.types";
import { VoiceTurnDependencies } from "./voice-turn.dependencies";
import {
  VOICE_TURN_STEP_REGISTRATIONS,
  type VoiceTurnStepDescriptor,
} from "./voice-turn-step.token";

@Injectable()
export class VoiceTurnStepFactory {
  constructor(
    private readonly deps: VoiceTurnDependencies,
    @Inject(VOICE_TURN_STEP_REGISTRATIONS)
    private readonly stepDescriptors: VoiceTurnStepDescriptor[],
  ) {}

  build(r: VoiceTurnRuntimeSet): IVoiceTurnStep[] {
    return [...this.stepDescriptors]
      .sort((a, b) => a.priority - b.priority)
      .map((d) => d.build(r, this.deps));
  }
}
