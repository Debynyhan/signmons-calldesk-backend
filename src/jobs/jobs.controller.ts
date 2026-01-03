import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { CreateJobRequestDto } from "./dto/create-job-request.dto";
import { JobResponseDto } from "./dto/job-response.dto";
import { ListJobsQueryDto } from "./dto/list-jobs-query.dto";
import { FirebaseAuthGuard } from "../auth/firebase-auth.guard";
import { TenantGuard } from "../common/guards/tenant.guard";
import type { Request } from "express";
import type { AuthenticatedUser } from "../auth/firebase-auth.guard";

@Controller("jobs")
@UseGuards(FirebaseAuthGuard, TenantGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  async createJob(
    @Body() dto: CreateJobRequestDto,
    @Req() request: Request,
  ): Promise<JobResponseDto> {
    const authUser = (request as Request & { authUser?: AuthenticatedUser })
      .authUser;
    const tenantId = authUser?.tenantId ?? dto.tenantId;
    const job = await this.jobsService.createJob({ ...dto, tenantId });
    return this.toJobResponse(job);
  }

  @Get()
  async listJobs(
    @Query() query: ListJobsQueryDto,
    @Req() request: Request,
  ): Promise<JobResponseDto[]> {
    const authUser = (request as Request & { authUser?: AuthenticatedUser })
      .authUser;
    const tenantId = authUser?.tenantId ?? query.tenantId;
    const jobs = await this.jobsService.listJobsDetailed(tenantId);
    return jobs.map((job) => this.toJobResponse(job));
  }

  private toJobResponse(
    job: Awaited<ReturnType<JobsService["createJob"]>>,
  ): JobResponseDto {
    return {
      id: job.id,
      tenantId: job.tenantId,
      customerId: job.customerId,
      propertyAddressId: job.propertyAddressId,
      serviceCategoryId: job.serviceCategoryId,
      assignedUserId: job.assignedUserId ?? undefined,
      status: job.status,
      urgency: job.urgency,
      description: job.description ?? null,
      preferredWindowLabel: job.preferredWindowLabel ?? null,
      pricingSnapshot: (job.pricingSnapshot as Record<string, unknown>) ?? null,
      policySnapshot: (job.policySnapshot as Record<string, unknown>) ?? null,
      serviceWindowStart: job.serviceWindowStart?.toISOString() ?? null,
      serviceWindowEnd: job.serviceWindowEnd?.toISOString() ?? null,
      offerExpiresAt: job.offerExpiresAt?.toISOString() ?? null,
      acceptedAt: job.acceptedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      serviceCategoryName: job.serviceCategory?.name,
    };
  }
}
