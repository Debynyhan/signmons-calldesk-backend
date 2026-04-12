import { Inject, Injectable } from "@nestjs/common";
import { VOICE_TURN_STEPS } from "./voice-turn.constants";
import type { IVoiceTurnStep, VoiceTurnStepContext } from "./voice-turn.step.interface";

@Injectable()
export class VoiceTurnPipeline {
  constructor(
    @Inject(VOICE_TURN_STEPS)
    private readonly steps: IVoiceTurnStep[],
  ) {}

  async run(ctx: VoiceTurnStepContext): Promise<unknown> {
    let current = ctx;
    for (const step of this.steps) {
      const result = await step.execute(current);
      if (result.kind === "exit") {
        return result.value;
      }
      current = result.ctx;
    }
    return undefined;
  }
}
