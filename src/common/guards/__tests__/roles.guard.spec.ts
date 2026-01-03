import { jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { RolesGuard } from "../roles.guard";
import { ROLES_KEY } from "../../decorators/roles.decorator";

const makeContext = (authUser?: { role?: string }): ExecutionContext => {
  const req = { authUser } as Record<string, unknown>;
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
};

describe("RolesGuard", () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it("allows when role matches", () => {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue(["admin"] as unknown as unknown[]);
    const context = makeContext({ role: "admin" });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects when role missing", () => {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue(["admin"] as unknown as unknown[]);
    const context = makeContext({});

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("rejects when role does not match", () => {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue(["admin"] as unknown as unknown[]);
    const context = makeContext({ role: "agent" });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("passes through when no roles metadata", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
    const context = makeContext();

    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalled();
  });
});
