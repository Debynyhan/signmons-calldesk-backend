const DEFAULT_API_URL = "http://localhost:3000";

const apiBase =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? DEFAULT_API_URL;

type JsonRecord = Record<string, unknown>;

export interface TenantRequest {
  name: string;
  displayName: string;
  instructions: string;
}

export interface TenantResponse {
  tenantId: string;
  displayName: string;
  instructions: string;
  prompt: string;
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

export interface DevAuthConfig {
  secret?: string;
  role?: string;
  userId?: string;
  tenantId?: string;
}

export interface RequestAuth {
  adminToken?: string;
  devAuth?: DevAuthConfig;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function buildAuthHeaders(
  auth?: RequestAuth,
  fallbackTenantId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const adminToken = auth?.adminToken?.trim();
  if (adminToken) {
    headers["x-admin-token"] = adminToken;
  }

  const secret = auth?.devAuth?.secret?.trim();
  if (secret) {
    headers["x-dev-auth"] = secret;
    const role = auth?.devAuth?.role?.trim();
    if (role) {
      headers["x-dev-role"] = role;
    }
    const userId = auth?.devAuth?.userId?.trim();
    if (userId) {
      headers["x-dev-user-id"] = userId;
    }
    const tenantId =
      auth?.devAuth?.tenantId?.trim() ?? fallbackTenantId?.trim();
    if (tenantId) {
      headers["x-dev-tenant-id"] = tenantId;
    }
  }

  return headers;
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
  auth?: RequestAuth,
): Promise<TenantResponse> {
  return postJson<TenantResponse>("/tenants", input, buildAuthHeaders(auth));
}

export async function sendTriage(
  input: TriageRequest,
  auth?: RequestAuth,
): Promise<TriageResponse> {
  return postJson<TriageResponse>(
    "/ai/triage",
    input,
    buildAuthHeaders(auth, input.tenantId),
  );
}

export function getApiBaseUrl(): string {
  return apiBase;
}
