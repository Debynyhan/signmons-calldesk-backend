const DEFAULT_API_URL = "http://localhost:3000";

const apiBase =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? DEFAULT_API_URL;
const devAuthToken = process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN?.trim();
const devAuthRole = process.env.NEXT_PUBLIC_DEV_AUTH_ROLE?.trim() || "admin";
const devAuthUserId =
  process.env.NEXT_PUBLIC_DEV_AUTH_USER_ID?.trim() || "dev-user";

export interface DevAuthInput {
  token: string;
  role?: string;
  userId?: string;
  tenantId?: string;
}

type JsonRecord = Record<string, unknown>;

export interface TenantSettingsInput {
  displayName?: string;
  instructions?: string;
  diagnosticFeeCents?: number;
  emergencySurchargeEnabled?: boolean;
  emergencySurchargeAmountCents?: number;
}

export interface TenantRequest {
  name: string;
  timezone?: string;
  settings?: TenantSettingsInput;
  adminToken: string;
}

export interface TenantResponse {
  tenantId: string;
  name: string;
  timezone: string;
  settings: TenantSettingsInput;
  prompt: string;
}

export interface TriageRequest {
  tenantId: string;
  sessionId: string;
  message: string;
  channel?: "VOICE" | "SMS" | "WEBCHAT";
  metadata?: Record<string, unknown>;
}

export type TriageResponse =
  | {
      status: "reply";
      reply: string;
    }
  | {
      status: "job_created";
      message: string;
      job: {
        id: string;
        tenantId: string;
        customerName: string;
        phone?: string;
        address?: string;
        issueCategory?: string;
        urgency?: string;
        description?: string;
        preferredTime?: string;
        status?: string;
        createdAt?: string;
      };
    }
  | JsonRecord;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function postJson<T>(
  path: string,
  body: JsonRecord,
  headers: Record<string, string> = {},
  devAuth?: DevAuthInput,
): Promise<T> {
  const tenantId =
    typeof body.tenantId === "string" ? body.tenantId : undefined;
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildDevAuthHeaders(tenantId, devAuth),
      ...headers,
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");

  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : (payload?.message as string) ?? "Request failed";
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export async function createTenant(
  input: TenantRequest,
  devAuth?: DevAuthInput,
): Promise<TenantResponse> {
  const { adminToken, ...payload } = input;

  return postJson<TenantResponse>("/tenants", payload, {
    "x-admin-token": adminToken.trim(),
  }, devAuth);
}

export async function sendTriage(
  input: TriageRequest,
  devAuth?: DevAuthInput,
): Promise<TriageResponse> {
  return postJson<TriageResponse>("/ai/triage", input, {}, devAuth);
}

export interface JobCreateRequest {
  tenantId: string;
  customerId: string;
  propertyAddressId: string;
  serviceCategoryId: string;
  assignedUserId?: string;
  urgency: "STANDARD" | "EMERGENCY";
  description?: string;
  preferredWindowLabel?: "ASAP" | "MORNING" | "AFTERNOON" | "EVENING";
  serviceWindowStart?: string;
  serviceWindowEnd?: string;
  pricingSnapshot?: Record<string, unknown>;
  policySnapshot?: Record<string, unknown>;
}

export interface JobResponse {
  id: string;
  tenantId: string;
  customerId: string;
  propertyAddressId: string;
  serviceCategoryId: string;
  assignedUserId?: string;
  status:
    | "CREATED"
    | "OFFERED"
    | "ACCEPTED"
    | "DECLINED"
    | "EXPIRED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "CANCELLED";
  urgency: "STANDARD" | "EMERGENCY";
  description?: string | null;
  preferredWindowLabel?: "ASAP" | "MORNING" | "AFTERNOON" | "EVENING" | null;
  pricingSnapshot?: Record<string, unknown> | null;
  policySnapshot?: Record<string, unknown> | null;
  serviceWindowStart?: string | null;
  serviceWindowEnd?: string | null;
  offerExpiresAt?: string | null;
  acceptedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  serviceCategoryName?: string;
}

export async function createJob(
  input: JobCreateRequest,
  devAuth?: DevAuthInput,
): Promise<JobResponse> {
  return postJson<JobResponse>("/jobs", input, {}, devAuth);
}

export async function listJobs(
  tenantId: string,
  devAuth?: DevAuthInput,
): Promise<JobResponse[]> {
  return getJson<JobResponse[]>("/jobs", { tenantId }, devAuth);
}

export interface ConversationCreateRequest {
  tenantId: string;
  customerId: string;
  channel: "VOICE" | "SMS" | "WEBCHAT";
  status?: "ONGOING" | "COMPLETED" | "ABANDONED" | "FAILED_PAYMENT";
  currentFSMState?: string;
  collectedData?: Record<string, unknown>;
  providerConversationId?: string;
  twilioCallSid?: string;
  twilioSmsSid?: string;
  startedAt?: string;
}

export interface ConversationResponse {
  id: string;
  tenantId: string;
  customerId: string;
  channel: "VOICE" | "SMS" | "WEBCHAT";
  status: "ONGOING" | "COMPLETED" | "ABANDONED" | "FAILED_PAYMENT";
  currentFSMState?: string | null;
  collectedData?: Record<string, unknown> | null;
  providerConversationId?: string | null;
  twilioCallSid?: string | null;
  twilioSmsSid?: string | null;
  startedAt: string;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function createConversation(
  input: ConversationCreateRequest,
  devAuth?: DevAuthInput,
): Promise<ConversationResponse> {
  return postJson<ConversationResponse>("/conversations", input, {}, devAuth);
}

export async function listConversations(
  tenantId: string,
  devAuth?: DevAuthInput,
): Promise<ConversationResponse[]> {
  return getJson<ConversationResponse[]>("/conversations", { tenantId }, devAuth);
}

export function getApiBaseUrl(): string {
  return apiBase;
}

async function getJson<T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  devAuth?: DevAuthInput,
): Promise<T> {
  const url = new URL(`${apiBase}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  const tenantId =
    typeof query?.tenantId === "string" ? query.tenantId : undefined;
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...buildDevAuthHeaders(tenantId, devAuth),
    },
    cache: "no-store",
  });

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : (payload?.message as string) ?? "Request failed";
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

function buildDevAuthHeaders(
  tenantId?: string,
  devAuth?: DevAuthInput,
): Record<string, string> {
  const token = devAuth?.token ?? devAuthToken;
  if (!token) {
    return {};
  }
  const role = devAuth?.role?.trim() || devAuthRole;
  const userId = devAuth?.userId?.trim() || devAuthUserId;
  const resolvedTenantId = devAuth?.tenantId ?? tenantId;
  return {
    "x-dev-auth": token,
    "x-dev-role": role,
    "x-dev-user-id": userId,
    ...(resolvedTenantId ? { "x-dev-tenant-id": resolvedTenantId } : {}),
  };
}
