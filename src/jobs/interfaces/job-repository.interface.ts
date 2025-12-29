export interface CreateJobPayload {
  customerName: string;
  phone: string;
  address?: string;
  issueCategory: string;
  urgency: string;
  description?: string;
  preferredTime?: string;
}

export interface CreateJobFromToolCallRequest {
  tenantId: string;
  sessionId: string;
  rawArgs?: string;
}

export type JobStatus =
  | "CREATED"
  | "OFFERED"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type JobUrgency = "STANDARD" | "EMERGENCY";

export interface JobRecord {
  id: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  serviceCategoryId: string;
  issueCategory: string;
  urgency: JobUrgency;
  description?: string;
  preferredTime?: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IJobRepository {
  createJobFromToolCall(
    request: CreateJobFromToolCallRequest,
  ): Promise<JobRecord>;

  listJobs(tenantId: string): Promise<JobRecord[]>;
}
