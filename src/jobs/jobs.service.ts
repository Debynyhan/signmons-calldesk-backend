import { BadRequestException, Injectable } from "@nestjs/common";
import {
  CreateJobFromToolCallRequest,
  CreateJobPayload,
  IJobRepository,
  JobRecord,
} from "./interfaces/job-repository.interface";
import { SanitizationService } from "../sanitization/sanitization.service";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateJobPayloadDto } from "./dto/create-job-payload.dto";

@Injectable()
export class InMemoryJobRepository implements IJobRepository {
  constructor(private readonly sanitizationService: SanitizationService) {}

  async createJobFromToolCall(
    request: CreateJobFromToolCallRequest
  ): Promise<JobRecord> {
    const payload = this.parsePayload(request.rawArgs);
    const sanitizedPayload = this.sanitizePayload(payload);
    const jobId = `job_${Date.now()}`;
    return {
      id: jobId,
      tenantId: this.sanitizationService.sanitizeIdentifier(request.tenantId),
      payload: sanitizedPayload,
      status: "pending",
      message: "Job creation stub. Replace with persistence later.",
    };
  }

  private parsePayload(rawArgs?: string): CreateJobPayload {
    let args: unknown;
    try {
      args = rawArgs ? JSON.parse(rawArgs) : null;
    } catch (error) {
      throw new BadRequestException("Invalid job creation payload.");
    }

    if (!args) {
      throw new BadRequestException("Job payload missing.");
    }

    const dto = plainToInstance(CreateJobPayloadDto, args);
    const errors = validateSync(dto, { whitelist: true });
    if (errors.length) {
      throw new BadRequestException("Job payload validation failed.");
    }

    return dto;
  }

  private sanitizePayload(payload: CreateJobPayload): CreateJobPayload {
    return {
      ...payload,
      customerName: this.sanitizationService.sanitizeText(
        payload.customerName
      ),
      phone: this.sanitizationService.normalizeWhitespace(payload.phone),
      address: payload.address
        ? this.sanitizationService.sanitizeText(payload.address)
        : undefined,
      description: payload.description
        ? this.sanitizationService.sanitizeText(payload.description)
        : undefined,
      preferredTime: payload.preferredTime
        ? this.sanitizationService.normalizeWhitespace(payload.preferredTime)
        : undefined,
    };
  }
}
