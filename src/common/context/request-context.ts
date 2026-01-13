import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";
export interface AuthenticatedUser {
  userId: string;
  tenantId?: string;
  role?: string;
}

export interface RequestContextData {
  requestId?: string;
  userId?: string;
  tenantId?: string;
  role?: string;
  impersonatedTenantId?: string;
}

const requestContext = new AsyncLocalStorage<RequestContextData>();

export function requestContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const initial: RequestContextData = {
    requestId:
      typeof req.headers["x-request-id"] === "string"
        ? req.headers["x-request-id"]
        : undefined,
  };

  requestContext.run(initial, () => {
    next();
  });
}

export function setAuthContext(
  authUser: AuthenticatedUser | undefined,
  impersonatedTenantId?: string | null,
): void {
  const store = requestContext.getStore();
  if (!store || !authUser) return;

  store.userId = authUser.userId;
  store.tenantId = authUser.tenantId;
  store.role = authUser.role;
  store.impersonatedTenantId = impersonatedTenantId ?? undefined;
}

export function getRequestContext(): RequestContextData | undefined {
  return requestContext.getStore();
}

export function hasTenantContext(): boolean {
  return Boolean(requestContext.getStore()?.tenantId);
}
