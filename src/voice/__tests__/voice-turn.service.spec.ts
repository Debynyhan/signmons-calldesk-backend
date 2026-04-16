import type { TenantOrganization } from "@prisma/client";
import { VoiceTurnPipeline } from "../voice-turn-pipeline.service";
import { VoiceTurnService } from "../voice-turn.service";

describe("VoiceTurnService", () => {
  let pipeline: { run: jest.Mock };
  let service: VoiceTurnService;

  const tenant = { id: "tenant-1" } as TenantOrganization;

  beforeEach(() => {
    pipeline = {
      run: jest.fn(),
    };
    service = new VoiceTurnService(pipeline as unknown as VoiceTurnPipeline);
  });

  it("delegates non-streaming turn execution to pipeline with normalized defaults", async () => {
    pipeline.run.mockResolvedValueOnce({ ok: true });

    const result = await service.handleTurn({
      tenant,
      callSid: "CA123",
      speechResult: undefined,
      confidence: undefined,
      requestId: "req-1",
    });

    expect(result).toEqual({ ok: true });
    expect(pipeline.run).toHaveBeenCalledWith({
      res: undefined,
      tenant,
      callSid: "CA123",
      requestId: "req-1",
      timingCollector: undefined,
      speechResult: null,
      rawConfidence: null,
    });
  });

  it("delegates streaming turns to pipeline and preserves timing collector", async () => {
    pipeline.run.mockResolvedValueOnce("<Response><Say>Hello</Say></Response>");
    const timingCollector = { aiMs: 125, aiCalls: 1 };

    const result = await service.handleStreamingTurn({
      tenant,
      callSid: "CA999",
      speechResult: "no heat",
      confidence: 0.91,
      requestId: "req-2",
      timingCollector,
    });

    expect(result).toBe("<Response><Say>Hello</Say></Response>");
    expect(pipeline.run).toHaveBeenCalledWith({
      res: undefined,
      tenant,
      callSid: "CA999",
      requestId: "req-2",
      timingCollector,
      speechResult: "no heat",
      rawConfidence: 0.91,
    });
  });
});
