import { jest } from "@jest/globals";
import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { ExecutionContext } from "@nestjs/common";
import { FirebaseAuthGuard } from "../firebase-auth.guard";
import { createRemoteJWKSet, jwtVerify } from "jose";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
}));

const jwtVerifyMock = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

type MockHttpContext = ExecutionContext & {
  switchToHttp(): {
    getRequest(): { headers: Record<string, string>; authUser?: unknown };
  };
};

describe("FirebaseAuthGuard", () => {
  const appConfig = {
    identityIssuer: "https://issuer.example.com",
    identityAudience: "signmons",
  };

  const configService = {
    get: jest.fn((key: string) => (key ? appConfig : appConfig)),
  } as unknown as ConfigService;

  const makeContext = (headers: Record<string, string>): MockHttpContext => {
    const req: { headers: Record<string, string>; authUser?: unknown } = {
      headers,
    };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as MockHttpContext;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    (configService.get as jest.Mock).mockReturnValue(appConfig);
    (createRemoteJWKSet as jest.Mock).mockReturnValue(jest.fn());
    jwtVerifyMock.mockReset();
  });

  it("authenticates and attaches authUser", async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "user-1", tenantId: "tenant-1", role: "agent" },
      protectedHeader: { alg: "RS256", kid: "kid-1" },
      key: {} as never,
    });

    const guard = new FirebaseAuthGuard(configService);
    const context = makeContext({ authorization: "Bearer test-token" });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(request.authUser).toEqual({
      userId: "user-1",
      tenantId: "tenant-1",
      role: "agent",
      claims: expect.objectContaining({ sub: "user-1" }),
      token: "test-token",
    });
    expect(jwtVerify).toHaveBeenCalledWith(
      "test-token",
      expect.any(Function),
      expect.objectContaining({
        issuer: appConfig.identityIssuer,
        audience: appConfig.identityAudience,
      }),
    );
  });

  it("rejects when token missing", async () => {
    const guard = new FirebaseAuthGuard(configService);
    const context = makeContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwtVerify).not.toHaveBeenCalled();
  });
});
