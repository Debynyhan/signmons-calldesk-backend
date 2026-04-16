import { Injectable } from "@nestjs/common";
import { AiService } from "../ai/ai.service";

@Injectable()
export class VoiceTurnAiDependencies {
  constructor(public readonly aiService: AiService) {}
}
