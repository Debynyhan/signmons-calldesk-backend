import { jest } from "@jest/globals";
import { Prisma } from "@prisma/client";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../../config/app.config";
import { SanitizationService } from "../../sanitization/sanitization.service";
import { PrismaTenantsService } from "../tenants.service";

type TenantRecord = {
  id: string;
  name: string;
  displayName: string;
  instructions: string | null;
  prompt: string;
  phoneNumber: string | null;
  featureFlags: Prisma.JsonValue | null;
  allowedTools: Prisma.JsonValue | Prisma.NullTypes.JsonNull;
  createdAt: Date;
  updatedAt: Date;
};

const baseTenant = (): TenantRecord => ({
  id: "tenant-123",
  name: "demo_hvac",
  displayName: "Demo HVAC",
  instructions: "Collect everything.",
  prompt: "Prompt text",
  phoneNumber: null,
  featureFlags: null,
  allowedTools: Prisma.JsonNull,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("PrismaTenantsService", () => {
  const config: ConfigType<typeof appConfig> = {
    environment: "test",
    openAiApiKey: "key",
    enablePreviewModel: false,
    enabledTools: [
      "create_job",
      "request_more_info",
      "mark_emergency",
      "update_customer_profile",
    ],
    port: 3000,
    databaseUrl: "postgres://example",
    adminApiToken: "token",
    corsOrigins: [],
  };

  const sanitizationService = new SanitizationService();
  let prisma: {
    tenant: {
      findUnique: jest.MockedFunction<
        (...args: unknown[]) => Promise<TenantRecord | null>
      >;
      create: jest.MockedFunction<
        (...args: unknown[]) => Promise<TenantRecord>
      >;
    };
  };

  beforeEach(() => {
    prisma = {
      tenant: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
  });

  const createService = () =>
    new PrismaTenantsService(
      prisma as never,
      sanitizationService,
      config as never,
    );

  it("stores JsonNull when no allowedTools are provided", async () => {
    const service = createService();
    prisma.tenant.create.mockResolvedValue(baseTenant());

    const context = await service.createTenant({
      name: "demo_hvac",
      displayName: "Demo HVAC",
      instructions: "Hello",
    });

    expect(prisma.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allowedTools: Prisma.JsonNull,
        }),
      }),
    );
    expect(context.allowedTools).toEqual(config.enabledTools);
    const createArgs = prisma.tenant.create.mock.calls[0]?.[0] as {
      data?: { prompt?: string };
    };
    expect(createArgs?.data?.prompt).toContain(
      "explicitly confirm the caller agrees to the $99 diagnostic/service fee",
    );
  });

  it("sanitizes and stores only allowed tool names", async () => {
    const service = createService();
    prisma.tenant.create.mockResolvedValue({
      ...baseTenant(),
      allowedTools: ["create_job", "update_customer_profile"],
    });

    await service.createTenant({
      name: "demo_hvac",
      displayName: "Demo HVAC",
      instructions: "Hello",
      allowedTools: [
        "CREATE_JOB",
        "update_customer_profile",
        "unknown_tool",
        "create_job",
      ],
    });

    expect(prisma.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allowedTools: ["create_job", "update_customer_profile"],
        }),
      }),
    );
  });

  it("returns stored allowed tools when present", async () => {
    const service = createService();
    prisma.tenant.findUnique.mockResolvedValue({
      ...baseTenant(),
      allowedTools: ["mark_emergency"],
    });

    const context = await service.getTenantContext("tenant-123");

    expect(context.allowedTools).toEqual(["mark_emergency"]);
  });

  it("falls back to config tools when tenant has none stored", async () => {
    const service = createService();
    prisma.tenant.findUnique.mockResolvedValue(baseTenant());

    const context = await service.getTenantContext("tenant-123");

    expect(context.allowedTools).toEqual(config.enabledTools);
  });
});
