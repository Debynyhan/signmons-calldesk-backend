import { Injectable } from "@nestjs/common";
import type { Response } from "express";
import type { TenantOrganization } from "@prisma/client";
import type { VoiceTurnTimingCollector } from "./voice-turn.step.interface";
import { VoiceTurnPipeline } from "./voice-turn-pipeline.service";

@Injectable()
export class VoiceTurnService {
  constructor(private readonly pipeline: VoiceTurnPipeline) {}

  async handleTurn(params: {
    res?: Response;
    tenant: TenantOrganization;
    callSid: string;
    speechResult?: string | null;
    confidence?: string | number | null;
    requestId?: string;
  }): Promise<unknown> {
    return this.pipeline.run({
      res: params.res,
      tenant: params.tenant,
      callSid: params.callSid,
      requestId: params.requestId,
      timingCollector: undefined,
      speechResult: params.speechResult ?? null,
      rawConfidence: params.confidence ?? null,
    });
  }

  async handleStreamingTurn(params: {
    tenant: TenantOrganization;
    callSid: string;
    speechResult?: string | null;
    confidence?: number;
    requestId?: string;
    timingCollector?: VoiceTurnTimingCollector;
  }): Promise<string> {
    return this.pipeline.run({
      res: undefined,
      tenant: params.tenant,
      callSid: params.callSid,
      requestId: params.requestId,
      timingCollector: params.timingCollector,
      speechResult: params.speechResult ?? null,
      rawConfidence: params.confidence ?? null,
    }) as Promise<string>;
  }
}
