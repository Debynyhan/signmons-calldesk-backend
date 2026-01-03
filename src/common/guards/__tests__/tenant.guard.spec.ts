import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { TenantGuard } from "../tenant.guard";

const makeContext = (opts: {
  tenantId?: string;
  authUser?: { tenantId?: string; role?: string };
}): ExecutionContext => {
  const req = {
    body: opts.tenantId ? { tenantId: opts.tenantId } : {},
    query: {},
    params: {},
    authUser: opts.authUser,
    headers: {},
  } as Record<string, unknown>;

  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
};

describe("TenantGuard", () => {
  const guard = new TenantGuard();

  it("allows when tenant matches", () => {
    const context = makeContext({
      tenantId: "tenant-1",
      authUser: { tenantId: "tenant-1" },
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows admin same-tenant without impersonation", () => {
    const context = makeContext({
      tenantId: "tenant-2",
      authUser: { tenantId: "tenant-2", role: "admin" },
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows admin cross-tenant with impersonation header", () => {
    const context = makeContext({
      tenantId: "tenant-2",
      authUser: { tenantId: "tenant-1", role: "admin" },
    });

    const req = context.switchToHttp().getRequest();
    (req as Record<string, unknown>).headers = {
      "x-impersonated-tenant": "tenant-2",
    };

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects admin cross-tenant without impersonation header", () => {
    const context = makeContext({
      tenantId: "tenant-2",
      authUser: { tenantId: "tenant-1", role: "admin" },
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("rejects when tenant missing", () => {
    const context = makeContext({ authUser: { tenantId: "tenant-1" } });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("rejects on tenant mismatch", () => {
    const context = makeContext({
      tenantId: "tenant-1",
      authUser: { tenantId: "tenant-2" },
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
