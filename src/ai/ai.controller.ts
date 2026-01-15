import {
  Body,
  Controller,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AiService } from "./ai.service";
import { TriageDto } from "./dto/triage.dto";
import { RequestAuthGuard } from "../auth/request-auth.guard";
import { TenantGuard } from "../common/guards/tenant.guard";
import { getRequestContext } from "../common/context/request-context";

@Controller("ai")
@UseGuards(RequestAuthGuard, TenantGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("triage")
  @Throttle({ default: { limit: 15, ttl: 60 } })
  async triage(@Body() { sessionId, message }: TriageDto) {
    const tenantId = getRequestContext()?.tenantId;
    if (!tenantId) {
      throw new UnauthorizedException("Tenant context is missing.");
    }
    return this.aiService.triage(tenantId, sessionId, message);
  }
}
