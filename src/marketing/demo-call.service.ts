import { Inject, Injectable } from "@nestjs/common";
import { Twilio } from "twilio";
import type { MarketingLead, MarketingLeadStatus } from "@prisma/client";
import appConfig, { type AppConfig } from "../config/app.config";
import { PrismaService } from "../prisma/prisma.service";
import { LoggingService } from "../logging/logging.service";

export const TRY_DEMO_RATE_LIMIT_MS = 5 * 60 * 1000;

export type TryDemoRetry = {
  allowed: boolean;
  afterSec: number;
  reason: string | null;
};

export type TryDemoResponse = {
  status: "queued" | "failed";
  leadId: string;
  call: {
    status: "initiated" | "failed";
    to: string;
    from: string;
    callSid: string | null;
  };
  estimatedWaitSec?: number;
  retry: TryDemoRetry;
};

@Injectable()
export class DemoCallService {
  private twilioClient: Twilio | null = null;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
  ) {}

  async place(lead: MarketingLead): Promise<TryDemoResponse> {
    const twilio = this.getTwilioClient();
    const to = lead.phone;
    const from = this.config.twilioPhoneNumber;
    const baseUrl = this.config.twilioWebhookBaseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/api/voice/demo-inbound?leadId=${lead.id}`;
    const statusCallback = `${baseUrl}/api/marketing/try-demo/status?leadId=${lead.id}`;

    try {
      const call = await twilio.calls.create({
        to,
        from,
        url,
        method: "POST",
        statusCallback,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["completed"],
      });
      await this.updateLeadStatus(lead.id, "CALLING", call.sid);

      this.loggingService.log(
        {
          event: "marketing.try_demo_called",
          leadId: lead.id,
          callSid: call.sid,
          to,
          from,
        },
        DemoCallService.name,
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
        DemoCallService.name,
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

  mapStatus(raw: string): MarketingLeadStatus | null {
    switch (raw) {
      case "completed":
        return "CALLED";
      case "busy":
      case "failed":
      case "no-answer":
      case "noanswer":
      case "canceled":
        return "FAILED";
      default:
        return null;
    }
  }

  mapLeadCallStatus(
    status: MarketingLeadStatus,
  ): "pending" | "calling" | "completed" | "failed" {
    switch (status) {
      case "CALLING":
        return "calling";
      case "CALLED":
        return "completed";
      case "FAILED":
        return "failed";
      default:
        return "pending";
    }
  }

  buildRetryInfo(lead: MarketingLead, now: Date): TryDemoRetry {
    if (lead.status !== "FAILED") {
      return { allowed: false, afterSec: 0, reason: null };
    }

    const remainingMs =
      lead.createdAt.getTime() + TRY_DEMO_RATE_LIMIT_MS - now.getTime();
    const retryAfterSec = Math.max(0, Math.ceil(remainingMs / 1000));
    const allowed = retryAfterSec === 0;

    return {
      allowed,
      afterSec: retryAfterSec,
      reason: allowed ? null : "rate_limited",
    };
  }

  normalizeFailureReason(reason: string | null): string | null {
    if (!reason) {
      return null;
    }

    const normalized = reason.toLowerCase().trim();
    const stripped = normalized.startsWith("call_status:")
      ? normalized.slice("call_status:".length)
      : normalized;
    if (
      stripped === "busy" ||
      stripped === "failed" ||
      stripped === "no-answer" ||
      stripped === "noanswer" ||
      stripped === "canceled" ||
      stripped === "provider_unavailable"
    ) {
      return stripped.replace("noanswer", "no-answer");
    }

    return "failed";
  }

  updateLeadStatus(
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

  private getTwilioClient(): Twilio {
    if (!this.twilioClient) {
      this.twilioClient = new Twilio(
        this.config.twilioAccountSid,
        this.config.twilioAuthToken,
      );
    }
    return this.twilioClient;
  }
}
