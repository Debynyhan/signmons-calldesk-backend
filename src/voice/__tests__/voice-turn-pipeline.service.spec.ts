import type {
  IVoiceTurnStep,
  VoiceTurnStepContext,
  VoiceTurnStepResult,
} from "../voice-turn.step.interface";
import { VoiceTurnPipeline } from "../voice-turn-pipeline.service";

describe("VoiceTurnPipeline", () => {
  const baseContext = {
    res: undefined,
    tenant: { id: "tenant-1" },
    callSid: "CA123",
    requestId: "req-1",
    timingCollector: undefined,
    speechResult: "no heat",
    rawConfidence: 0.91,
  } as unknown as VoiceTurnStepContext;

  const createStep = (
    execute: (ctx: VoiceTurnStepContext) => Promise<VoiceTurnStepResult>,
  ): IVoiceTurnStep => ({ execute });

  it("runs steps in order and stops on exit", async () => {
    const firstStepExecute = jest.fn(async (ctx: VoiceTurnStepContext) => ({
      kind: "continue",
      ctx: {
        ...ctx,
        normalizedSpeech: "normalized",
      },
    }));
    const secondStepExecute = jest.fn(async () => ({
      kind: "exit",
      value: "<Response><Say>done</Say></Response>",
    }));
    const thirdStepExecute = jest.fn();

    const pipeline = new VoiceTurnPipeline([
      createStep(firstStepExecute),
      createStep(secondStepExecute),
      createStep(thirdStepExecute as never),
    ]);

    const result = await pipeline.run(baseContext);

    expect(result).toBe("<Response><Say>done</Say></Response>");
    expect(firstStepExecute).toHaveBeenCalledWith(baseContext);
    expect(secondStepExecute).toHaveBeenCalledWith(
      expect.objectContaining({ normalizedSpeech: "normalized" }),
    );
    expect(thirdStepExecute).not.toHaveBeenCalled();
  });

  it("returns undefined when all steps continue", async () => {
    const stepOne = createStep(async (ctx) => ({ kind: "continue", ctx }));
    const stepTwo = createStep(async (ctx) => ({ kind: "continue", ctx }));

    const pipeline = new VoiceTurnPipeline([stepOne, stepTwo]);

    await expect(pipeline.run(baseContext)).resolves.toBeUndefined();
  });
});
