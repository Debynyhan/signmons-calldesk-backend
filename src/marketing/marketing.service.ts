import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  MarketingLead,
  MarketingLeadStatus,
  Prisma,
} from "@prisma/client";
import appConfig, { type AppConfig } from "../config/app.config";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { LoggingService } from "../logging/logging.service";
import type { TryDemoDto } from "./dto/try-demo.dto";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import { Inject } from "@nestjs/common";
import {
  DemoCallService,
  TRY_DEMO_RATE_LIMIT_MS,
  type TryDemoResponse,
  type TryDemoRetry,
} from "./demo-call.service";

type TryDemoStatusResponse = {
  leadId: string;
  status: MarketingLeadStatus;
  call: {
    status: "pending" | "calling" | "completed" | "failed";
    callSid: string | null;
  };
  failureReason: string | null;
  retry: TryDemoRetry;
};

@Injectable()
export class MarketingService {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
    private readonly loggingService: LoggingService,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    private readonly demoCallService: DemoCallService,
  ) {}

  async submitTryDemo(payload: TryDemoDto): Promise<TryDemoResponse> {
    if (!payload.consentToAutoCall) {
      throw new BadRequestException("Consent is required to place a demo call.");
    }

    const normalizedPhone = this.sanitizationService.normalizePhoneE164(
      payload.phone,
    );
    if (!normalizedPhone) {
      throw new BadRequestException("Invalid phone number.");
    }

    const demoTenantId = this.config.demoTenantId;
    if (!demoTenantId) {
      throw new ServiceUnavailableException("Demo tenant is not configured.");
    }

    const tenant = await this.tenantsService.getTenantById(demoTenantId);
    if (!tenant) {
      throw new ServiceUnavailableException("Demo tenant not found.");
    }

    if (!this.config.voiceEnabled) {
      throw new ServiceUnavailableException("Voice demo is unavailable.");
    }

    if (!this.config.twilioPhoneNumber || !this.config.twilioWebhookBaseUrl) {
      throw new ServiceUnavailableException("Voice demo is not configured.");
    }

    const now = new Date();
    const recentLead = await this.findRecentLead(normalizedPhone, now);
    if (recentLead) {
      return this.buildRateLimitedResponse(recentLead, normalizedPhone, now);
    }

    const leadId = randomUUID();
    const created = await this.prisma.marketingLead.create({
      data: {
        id: leadId,
        tenantId: tenant.id,
        phone: normalizedPhone,
        name: payload.name
          ? this.sanitizationService.sanitizeText(payload.name)
          : null,
        company: payload.company
          ? this.sanitizationService.sanitizeText(payload.company)
          : null,
        email: payload.email
          ? this.sanitizationService.sanitizeText(payload.email)
          : null,
        consentToAutoCall: true,
        consentTextVersion: payload.consentTextVersion,
        demoScenario: payload.demoScenario ?? null,
        callMode: payload.callMode ?? "immediate",
        timezone: payload.timezone
          ? this.sanitizationService.sanitizeText(payload.timezone)
          : null,
        preferredCallTime: this.parsePreferredTime(payload.preferredCallTime),
        utm: this.sanitizeUtm(payload.utm),
        referrerUrl: payload.referrerUrl
          ? this.sanitizationService.sanitizeText(payload.referrerUrl)
          : null,
        status: "PENDING",
      },
    });

    return this.demoCallService.place(created);
  }

  async handleTryDemoStatusCallback(
    payload: Record<string, string | undefined>,
    leadId?: string,
  ): Promise<void> {
    const callSid = payload.CallSid ?? payload.callSid;
    const rawStatus = payload.CallStatus ?? payload.callStatus;
    if (!rawStatus) {
      this.loggingService.warn(
        {
          event: "marketing.try_demo_status_callback_missing_status",
          leadId: leadId ?? null,
          callSid: callSid ?? null,
        },
        MarketingService.name,
      );
      return;
    }

    const callStatus = rawStatus.toLowerCase();
    const nextStatus = this.demoCallService.mapStatus(callStatus);
    if (!nextStatus) {
      return;
    }

    const lead = leadId
      ? await this.prisma.marketingLead.findUnique({ where: { id: leadId } })
      : callSid
        ? await this.prisma.marketingLead.findFirst({ where: { callSid } })
        : null;

    if (!lead) {
      this.loggingService.warn(
        {
          event: "marketing.try_demo_status_callback_lead_missing",
          leadId: leadId ?? null,
          callSid: callSid ?? null,
          callStatus,
        },
        MarketingService.name,
      );
      return;
    }

    if (lead.status === "CALLED" || lead.status === "FAILED") {
      return;
    }

    const errorReason = nextStatus === "FAILED" ? callStatus : undefined;
    await this.demoCallService.updateLeadStatus(
      lead.id,
      nextStatus,
      callSid ?? lead.callSid ?? null,
      errorReason,
    );

    this.loggingService.log(
      {
        event: "marketing.try_demo_status_callback",
        leadId: lead.id,
        callSid: callSid ?? lead.callSid ?? null,
        callStatus,
        nextStatus,
      },
      MarketingService.name,
    );
  }

  async getTryDemoStatus(leadId: string): Promise<TryDemoStatusResponse> {
    const lead = await this.prisma.marketingLead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException("Demo lead not found.");
    }

    const now = new Date();
    const retry = this.demoCallService.buildRetryInfo(lead, now);
    const failureReason =
      lead.status === "FAILED"
        ? this.demoCallService.normalizeFailureReason(lead.errorReason)
        : null;

    return {
      leadId: lead.id,
      status: lead.status,
      call: {
        status: this.demoCallService.mapLeadCallStatus(lead.status),
        callSid: lead.callSid ?? null,
      },
      failureReason,
      retry,
    };
  }

  private async findRecentLead(
    phone: string,
    now: Date,
  ): Promise<MarketingLead | null> {
    const since = new Date(now.getTime() - TRY_DEMO_RATE_LIMIT_MS);
    return this.prisma.marketingLead.findFirst({
      where: {
        phone,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private buildRateLimitedResponse(
    lead: MarketingLead,
    phone: string,
    now: Date,
  ): TryDemoResponse {
    const remainingMs =
      lead.createdAt.getTime() + TRY_DEMO_RATE_LIMIT_MS - now.getTime();
    const retryAfterSec = Math.max(1, Math.ceil(remainingMs / 1000));

    this.loggingService.log(
      {
        event: "marketing.try_demo_rate_limited",
        leadId: lead.id,
        phone,
        retryAfterSec,
      },
      MarketingService.name,
    );

    return {
      status: "failed",
      leadId: lead.id,
      call: {
        status: "failed",
        to: phone,
        from: this.config.twilioPhoneNumber,
        callSid: null,
      },
      retry: {
        allowed: true,
        afterSec: retryAfterSec,
        reason: "rate_limited",
      },
    };
  }

  private parsePreferredTime(value?: string): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("Invalid preferredCallTime.");
    }
    return parsed;
  }

  private sanitizeUtm(
    utm?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (!utm) {
      return undefined;
    }
    try {
      return JSON.parse(JSON.stringify(utm)) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }

}
