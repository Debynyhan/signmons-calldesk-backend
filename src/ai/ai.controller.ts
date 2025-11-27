import { Body, Controller, Post } from "@nestjs/common";
import { AiService } from "./ai.service";
import { TriageDto } from "./dto/triage.dto";

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("triage")
  async triage(@Body() { tenantId, message }: TriageDto) {
    return this.aiService.triage(tenantId, message);
  }
}
