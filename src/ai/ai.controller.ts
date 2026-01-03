import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AiService } from "./ai.service";
import { TriageDto } from "./dto/triage.dto";
import { FirebaseAuthGuard } from "../auth/firebase-auth.guard";
import { TenantGuard } from "../common/guards/tenant.guard";
import type { Request } from "express";
import type { AuthenticatedUser } from "../auth/firebase-auth.guard";

@Controller("ai")
@UseGuards(FirebaseAuthGuard, TenantGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("triage")
  @Throttle({ default: { limit: 15, ttl: 60 } })
  async triage(@Body() dto: TriageDto, @Req() request: Request) {
    const authUser = (request as Request & { authUser?: AuthenticatedUser })
      .authUser;
    const tenantId = authUser?.tenantId ?? dto.tenantId;
    const { sessionId, message, channel, metadata } = dto;

    return this.aiService.triage(tenantId, sessionId, message, {
      channel,
      metadata,
    });
  }
}
