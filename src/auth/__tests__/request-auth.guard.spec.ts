import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { RequestAuthGuard } from "../request-auth.guard";
import type { FirebaseAdminService } from "../firebase-admin.service";

describe("RequestAuthGuard", () => {
  const makeContext = (headers: Record<string, string | undefined>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          header: (name: string) => headers[name.toLowerCase()],
        }),
      }),
    }) as unknown as ExecutionContext;

  it("rejects dev headers when dev auth is disabled", async () => {
    const config = {
      devAuthEnabled: false,
      environment: "development",
    } as never;
    const firebaseAdmin = {} as FirebaseAdminService;
    const guard = new RequestAuthGuard(config, firebaseAdmin);

    await expect(
      guard.canActivate(
        makeContext({
          "x-dev-auth": "dev-auth-secret",
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("blocks dev auth when running in production", async () => {
    const config = {
      devAuthEnabled: true,
      environment: "production",
    } as never;
    const firebaseAdmin = {} as FirebaseAdminService;
    const guard = new RequestAuthGuard(config, firebaseAdmin);

    await expect(
      guard.canActivate(
        makeContext({
          "x-dev-auth": "dev-auth-secret",
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("requires role claim in JWT mode", async () => {
    const config = {
      devAuthEnabled: false,
      environment: "development",
      identityIssuer: "https://securetoken.google.com/signmons",
      identityAudience: "signmons",
    } as never;
    const firebaseAdmin = {
      getAuth: () => ({
        verifyIdToken: async () =>
          ({
            iss: "https://securetoken.google.com/signmons",
            aud: "signmons",
            tenantId: "tenant-123",
            sub: "user-123",
          }) as unknown,
      }),
    } as FirebaseAdminService;
    const guard = new RequestAuthGuard(config, firebaseAdmin);

    await expect(
      guard.canActivate(
        makeContext({
          authorization: "Bearer test-token",
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
