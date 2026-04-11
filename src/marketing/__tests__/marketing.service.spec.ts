import type { MarketingLead } from "@prisma/client";
import type { AppConfig } from "../../config/app.config";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { TenantsService } from "../../tenants/interfaces/tenants-service.interface";
import type { LoggingService } from "../../logging/logging.service";
import { MarketingService } from "../marketing.service";
import type { DemoCallService } from "../demo-call.service";

describe("MarketingService", () => {
  it("rate-limits by phone within 5 minutes", async () => {
    const prisma = {
      marketingLead: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const tenantsService = {
      getTenantById: jest.fn().mockResolvedValue({ id: "tenant-1" }),
    };
    const loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
    };
    const config = {
      voiceEnabled: true,
      twilioPhoneNumber: "+12167448929",
      twilioWebhookBaseUrl: "https://example.ngrok.io",
      twilioAccountSid: "AC123",
      twilioAuthToken: "token",
      demoTenantId: "tenant-1",
    } as AppConfig;

    const recentLead = {
      id: "lead-1",
      phone: "+12165551234",
      createdAt: new Date(Date.now() - 60 * 1000),
    } as MarketingLead;
    prisma.marketingLead.findFirst.mockResolvedValue(recentLead);

    const demoCallService = {
      place: jest.fn(),
      mapStatus: jest.fn(),
      buildRetryInfo: jest.fn().mockReturnValue({
        allowed: true,
        afterSec: 240,
        reason: "rate_limited",
      }),
      normalizeFailureReason: jest.fn(),
      mapLeadCallStatus: jest.fn(),
      updateLeadStatus: jest.fn(),
    };

    const service = new MarketingService(
      config,
      prisma as unknown as PrismaService,
      new SanitizationService(),
      loggingService as LoggingService,
      tenantsService as TenantsService,
      demoCallService as unknown as DemoCallService,
    );

    const response = await service.submitTryDemo({
      phone: "+12165551234",
      consentToAutoCall: true,
      consentTextVersion: "try-demo-v1",
      name: "Ben",
    });

    expect(response.status).toBe("failed");
    expect(response.leadId).toBe("lead-1");
    expect(response.retry).toEqual(
      expect.objectContaining({
        allowed: true,
        reason: "rate_limited",
      }),
    );
    expect(response.retry.afterSec).toBeGreaterThan(0);
    expect(response.retry.afterSec).toBeLessThanOrEqual(300);
    expect(prisma.marketingLead.create).not.toHaveBeenCalled();
    expect(prisma.marketingLead.update).not.toHaveBeenCalled();
  });
});
