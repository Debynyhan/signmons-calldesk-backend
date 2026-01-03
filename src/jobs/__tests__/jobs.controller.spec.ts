import { Test } from "@nestjs/testing";
import type { Request } from "express";
import type { CreateJobRequestDto } from "../dto/create-job-request.dto";
import type { ListJobsQueryDto } from "../dto/list-jobs-query.dto";
import { JobsController } from "../jobs.controller";
import { JobsService } from "../jobs.service";
import { FirebaseAuthGuard } from "../../auth/firebase-auth.guard";
import { TenantGuard } from "../../common/guards/tenant.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ConfigService } from "@nestjs/config";

describe("JobsController", () => {
  let controller: JobsController;
  const jobsService = {
    createJob: jest.fn(),
    listJobsDetailed: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        {
          provide: JobsService,
          useValue: jobsService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: FirebaseAuthGuard,
          useValue: {
            canActivate: () => true,
          },
        },
        {
          provide: TenantGuard,
          useValue: {
            canActivate: () => true,
          },
        },
        {
          provide: RolesGuard,
          useValue: {
            canActivate: () => true,
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(JobsController);
  });

  afterEach(() => {
    jobsService.createJob.mockReset();
    jobsService.listJobsDetailed.mockReset();
  });

  it("creates a job", async () => {
    const now = new Date("2025-01-01T00:00:00.000Z");
    const later = new Date("2025-01-01T01:00:00.000Z");
    jobsService.createJob.mockResolvedValue({
      id: "job-1",
      tenantId: "tenant-1",
      customerId: "customer-1",
      propertyAddressId: "address-1",
      serviceCategoryId: "category-1",
      assignedUserId: null,
      status: "CREATED",
      urgency: "STANDARD",
      description: null,
      pricingSnapshot: { basePriceCents: 0 },
      policySnapshot: { preferredWindowLabel: null },
      preferredWindowLabel: null,
      serviceWindowStart: null,
      serviceWindowEnd: null,
      offerExpiresAt: null,
      acceptedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: later,
      serviceCategory: { name: "HEATING" },
    });

    const response = await controller.createJob(
      {
        tenantId: "tenant-1",
        customerId: "customer-1",
        propertyAddressId: "address-1",
        serviceCategoryId: "category-1",
        urgency: "STANDARD",
      } as CreateJobRequestDto,
      { authUser: { tenantId: "tenant-1" } } as unknown as Request,
    );

    expect(response).toMatchObject({
      id: "job-1",
      tenantId: "tenant-1",
      customerId: "customer-1",
      propertyAddressId: "address-1",
      serviceCategoryId: "category-1",
      status: "CREATED",
      urgency: "STANDARD",
      pricingSnapshot: { basePriceCents: 0 },
      policySnapshot: { preferredWindowLabel: null },
      createdAt: now.toISOString(),
      updatedAt: later.toISOString(),
      serviceCategoryName: "HEATING",
    });
    expect(response.assignedUserId).toBeUndefined();
  });

  it("lists jobs for a tenant", async () => {
    const now = new Date("2025-01-02T00:00:00.000Z");
    jobsService.listJobsDetailed.mockResolvedValue([
      {
        id: "job-2",
        tenantId: "tenant-2",
        customerId: "customer-2",
        propertyAddressId: "address-2",
        serviceCategoryId: "category-2",
        assignedUserId: "tech-1",
        status: "CREATED",
        urgency: "EMERGENCY",
        description: "No heat",
        pricingSnapshot: { basePriceCents: 0 },
        policySnapshot: { preferredWindowLabel: "ASAP" },
        preferredWindowLabel: "ASAP",
        serviceWindowStart: null,
        serviceWindowEnd: null,
        offerExpiresAt: null,
        acceptedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        serviceCategory: { name: "HEATING" },
      },
    ]);

    const response = await controller.listJobs(
      {
        tenantId: "tenant-2",
      } as ListJobsQueryDto,
      { authUser: { tenantId: "tenant-2" } } as unknown as Request,
    );

    expect(response).toEqual([
      {
        id: "job-2",
        tenantId: "tenant-2",
        customerId: "customer-2",
        propertyAddressId: "address-2",
        serviceCategoryId: "category-2",
        assignedUserId: "tech-1",
        status: "CREATED",
        urgency: "EMERGENCY",
        description: "No heat",
        preferredWindowLabel: "ASAP",
        pricingSnapshot: { basePriceCents: 0 },
        policySnapshot: { preferredWindowLabel: "ASAP" },
        serviceWindowStart: null,
        serviceWindowEnd: null,
        offerExpiresAt: null,
        acceptedAt: null,
        completedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        serviceCategoryName: "HEATING",
      },
    ]);
  });
});
