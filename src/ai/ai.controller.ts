import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AiService } from "./ai.service";
import { TriageDto } from "./dto/triage.dto";
import { FirebaseAuthGuard } from "../auth/firebase-auth.guard";

@Controller("ai")
@UseGuards(FirebaseAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("triage")
  @Throttle({ default: { limit: 15, ttl: 60 } })
  async triage(@Body() dto: TriageDto) {
    const { tenantId, sessionId, message, channel, metadata } = dto;
    return this.aiService.triage(tenantId, sessionId, message, {
      channel,
      metadata,
    });
  }
}
