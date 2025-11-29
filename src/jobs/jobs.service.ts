import { Injectable } from "@nestjs/common";
import {
  CreateJobRequest,
  JobRecord,
  JobsService,
} from "./interfaces/jobs-service.interface";
import { SanitizationService } from "../sanitization/sanitization.service";

@Injectable()
export class InMemoryJobsService implements JobsService {
  constructor(private readonly sanitizationService: SanitizationService) {}

  async createJob(request: CreateJobRequest): Promise<JobRecord> {
    const sanitizedPayload = this.sanitizePayload(request.payload);
    const jobId = `job_${Date.now()}`;
    return {
      id: jobId,
      tenantId: this.sanitizationService.sanitizeIdentifier(request.tenantId),
      payload: sanitizedPayload,
      status: "pending",
      message: "Job creation stub. Replace with persistence later.",
    };
  }

  private sanitizePayload(payload: CreateJobRequest["payload"]) {
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
