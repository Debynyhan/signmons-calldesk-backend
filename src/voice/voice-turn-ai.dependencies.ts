import { Inject, Injectable } from "@nestjs/common";
import { AI_SERVICE, type IAiService } from "../ai/ai.service.interface";

@Injectable()
export class VoiceTurnAiDependencies {
  constructor(
    @Inject(AI_SERVICE)
    public readonly aiService: IAiService,
  ) {}
}
