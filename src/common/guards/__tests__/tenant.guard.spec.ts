import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { TenantGuard } from "../tenant.guard";

const makeContext = (opts: {
  authUser?: { tenantId?: string; role?: string };
  headers?: Record<string, string>;
}): ExecutionContext => {
  const req = {
    body: {},
    query: {},
    params: {},
    authUser: opts.authUser,
    headers: opts.headers ?? {},
  } as Record<string, unknown>;

  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
};

describe("TenantGuard", () => {
  const guard = new TenantGuard();

  it("allows when tenant matches", () => {
    const context = makeContext({
      authUser: { tenantId: "tenant-1" },
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows admin same-tenant without impersonation", () => {
    const context = makeContext({
      authUser: { tenantId: "tenant-2", role: "admin" },
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows admin cross-tenant with impersonation header", () => {
    const context = makeContext({
      authUser: { tenantId: "tenant-1", role: "admin" },
      headers: { "x-impersonated-tenant": "tenant-2" },
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects when tenant missing in auth and no impersonation", () => {
    const context = makeContext({ authUser: {} });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
