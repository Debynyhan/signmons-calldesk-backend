import { Test } from "@nestjs/testing";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import request from "supertest";
import { Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { AuthenticatedUser } from "../firebase-auth.guard";
import { TenantGuard } from "../../common/guards/tenant.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ConfigService } from "@nestjs/config";
import type { CanActivate, ExecutionContext } from "@nestjs/common";

let mockAuthUser: AuthenticatedUser | undefined;

class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ authUser?: AuthenticatedUser }>();
    req.authUser = mockAuthUser;
    return true;
  }
}

@Controller("guard-test")
@UseGuards(MockAuthGuard, TenantGuard, RolesGuard)
class GuardedController {
  @Get("ok")
  @Roles("admin")
  handle(@Req() request: { authUser?: AuthenticatedUser }) {
    return { tenant: request.authUser?.tenantId, role: request.authUser?.role };
  }
}

describe("Guards e2e", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GuardedController],
      providers: [
        TenantGuard,
        RolesGuard,
        Reflector,
        MockAuthGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          } as unknown as ConfigService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows admin with matching tenant", async () => {
    mockAuthUser = {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "admin",
      claims: {},
      token: "token",
    };

    const server = request(
      app.getHttpServer() as unknown as import("http").Server,
    );
    const res = await server
      .get("/guard-test/ok")
      .query({ tenantId: "tenant-1" })
      .expect(200);

    expect(res.body).toEqual({ tenant: "tenant-1", role: "admin" });
  });

  it("rejects on tenant mismatch", async () => {
    mockAuthUser = {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "agent",
      claims: {},
      token: "token",
    };

    const server = request(
      app.getHttpServer() as unknown as import("http").Server,
    );
    await server
      .get("/guard-test/ok")
      .query({ tenantId: "tenant-2" })
      .expect(403);
  });

  it("rejects on insufficient role", async () => {
    mockAuthUser = {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "agent",
      claims: {},
      token: "token",
    };

    const server = request(
      app.getHttpServer() as unknown as import("http").Server,
    );
    await server
      .get("/guard-test/ok")
      .query({ tenantId: "tenant-1" })
      .expect(403);
  });
});
