export interface CreateJobPayload {
  customerName: string;
  phone: string;
  address?: string;
  issueCategory: string;
  urgency: string;
  description?: string;
  preferredTime?: string;
}

export interface CreateJobRequest {
  tenantId: string;
  payload: CreateJobPayload;
}

export interface CreateJobFromToolCallRequest {
  tenantId: string;
  rawArgs?: string;
}

export interface JobRecord {
  id: string;
  tenantId: string;
  payload: CreateJobPayload;
  status: string;
  message?: string;
}

export interface JobsService {
  createJobFromToolCall(
    request: CreateJobFromToolCallRequest
  ): Promise<JobRecord>;
}
