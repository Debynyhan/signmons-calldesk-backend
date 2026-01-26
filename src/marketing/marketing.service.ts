import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { Twilio } from "twilio";
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

const TRY_DEMO_RATE_LIMIT_MS = 5 * 60 * 1000;

type TryDemoResponse = {
  status: "queued" | "failed";
  leadId: string;
  call: {
    status: "initiated" | "failed";
    to: string;
    from: string;
    callSid: string | null;
  };
  estimatedWaitSec?: number;
  retry: {
    allowed: boolean;
    afterSec: number;
    reason: string | null;
  };
};

@Injectable()
export class MarketingService {
  private twilioClient: Twilio | null = null;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
    private readonly loggingService: LoggingService,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
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

    return this.placeDemoCall(created);
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

  private async placeDemoCall(lead: MarketingLead): Promise<TryDemoResponse> {
    const twilio = this.getTwilioClient();
    const to = lead.phone;
    const from = this.config.twilioPhoneNumber;
    const baseUrl = this.config.twilioWebhookBaseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/api/voice/demo-inbound?leadId=${lead.id}`;

    try {
      const call = await twilio.calls.create({ to, from, url, method: "POST" });
      await this.updateLeadStatus(lead.id, "CALLING", call.sid);

      this.loggingService.log(
        {
          event: "marketing.try_demo_called",
          leadId: lead.id,
          callSid: call.sid,
          to,
          from,
        },
        MarketingService.name,
      );

      return {
        status: "queued",
        leadId: lead.id,
        call: {
          status: "initiated",
          to,
          from,
          callSid: call.sid,
        },
        estimatedWaitSec: 20,
        retry: {
          allowed: false,
          afterSec: 0,
          reason: null,
        },
      };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "provider_unavailable";
      await this.updateLeadStatus(lead.id, "FAILED", null, reason);

      this.loggingService.warn(
        {
          event: "marketing.try_demo_call_failed",
          leadId: lead.id,
          to,
          from,
          reason,
        },
        MarketingService.name,
      );

      return {
        status: "failed",
        leadId: lead.id,
        call: {
          status: "failed",
          to,
          from,
          callSid: null,
        },
        retry: {
          allowed: true,
          afterSec: 60,
          reason: "provider_unavailable",
        },
      };
    }
  }

  private getTwilioClient(): Twilio {
    if (!this.twilioClient) {
      this.twilioClient = new Twilio(
        this.config.twilioAccountSid,
        this.config.twilioAuthToken,
      );
    }
    return this.twilioClient;
  }

  private updateLeadStatus(
    leadId: string,
    status: MarketingLeadStatus,
    callSid: string | null,
    errorReason?: string,
  ) {
    return this.prisma.marketingLead.update({
      where: { id: leadId },
      data: {
        status,
        callSid,
        lastCallAt: new Date(),
        errorReason: errorReason ?? null,
      },
    });
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
