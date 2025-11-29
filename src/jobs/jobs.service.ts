import { Injectable } from "@nestjs/common";
import {
  CreateJobRequest,
  JobRecord,
  JobsService,
} from "./interfaces/jobs-service.interface";

@Injectable()
export class InMemoryJobsService implements JobsService {
  async createJob(request: CreateJobRequest): Promise<JobRecord> {
    const jobId = `job_${Date.now()}`;
    return {
      id: jobId,
      tenantId: request.tenantId,
      payload: request.payload,
      status: "pending",
      message: "Job creation stub. Replace with persistence later.",
    };
  }
}
