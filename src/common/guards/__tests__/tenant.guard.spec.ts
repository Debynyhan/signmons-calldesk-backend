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

  it("allows admin with tenant provided", () => {
    const context = makeContext({
      tenantId: "tenant-2",
      authUser: { tenantId: "other", role: "admin" },
    });

    expect(guard.canActivate(context)).toBe(true);
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
