const DEFAULT_API_URL = "http://localhost:3000";

const apiBase =
  process.env.NEXT_PUBLIC_BACKEND_API_URL?.replace(/\/$/, "") ??
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  DEFAULT_API_URL;

type JsonRecord = Record<string, unknown>;

export interface TenantRequest {
  name: string;
  displayName: string;
  instructions: string;
  adminToken: string;
  allowedTools: string[];
}

export interface TenantResponse {
  tenantId: string;
  displayName: string;
  instructions: string;
  prompt: string;
}

export interface TenantAnalyticsSnapshot {
  callCount: number;
  jobsCreated: number;
  toolUsage: Record<string, number>;
  averageInfoCollectionMs: number;
}

export interface TriageRequest {
  tenantId: string;
  sessionId: string;
  message: string;
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
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
): Promise<TenantResponse> {
  const { adminToken, ...payload } = input;

  return postJson<TenantResponse>("/tenants", payload, {
    "x-admin-token": adminToken.trim(),
  });
}

export async function sendTriage(
  input: TriageRequest,
): Promise<TriageResponse> {
  return postJson<TriageResponse>("/ai/triage", input);
}

export async function getTenantAnalytics(
  tenantId: string,
  adminToken: string,
): Promise<TenantAnalyticsSnapshot> {
  const response = await fetch(`${apiBase}/tenants/${tenantId}/analytics`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": adminToken.trim(),
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

  return payload as TenantAnalyticsSnapshot;
}

export function getApiBaseUrl(): string {
  return apiBase;
}
