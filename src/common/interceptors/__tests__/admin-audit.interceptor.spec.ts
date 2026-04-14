import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { createHash } from "crypto";
import { lastValueFrom, of, throwError } from "rxjs";
import { LoggingService } from "../../../logging/logging.service";
import { AdminAuditInterceptor } from "../admin-audit.interceptor";

describe("AdminAuditInterceptor", () => {
  const buildContext = (params?: {
    method?: string;
    url?: string;
    ip?: string;
    statusCode?: number;
    headers?: Record<string, string | undefined>;
    type?: "http" | "ws";
  }): ExecutionContext => {
    const headers = Object.fromEntries(
      Object.entries(params?.headers ?? {}).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );

    const request = {
      method: params?.method ?? "POST",
      originalUrl: params?.url ?? "/tenants",
      url: params?.url ?? "/tenants",
      ip: params?.ip ?? "127.0.0.1",
      ips: [],
      header: (name: string) => headers[name.toLowerCase()],
    };
    const response = { statusCode: params?.statusCode ?? 200 };

    return {
      getType: () => params?.type ?? "http",
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  };

  it("logs admin audit data on success with token fingerprint", async () => {
    const loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as LoggingService;
    const interceptor = new AdminAuditInterceptor(loggingService);

    const token = "dev-admin-token-123";
    const expectedFingerprint = createHash("sha256")
      .update(token)
      .digest("hex")
      .slice(0, 16);

    const context = buildContext({
      statusCode: 201,
      ip: "203.0.113.10",
      headers: { "x-admin-token": token },
    });
    const next: CallHandler = {
      handle: () => of({ ok: true }),
    };

    await lastValueFrom(interceptor.intercept(context, next));

    expect(loggingService.warn).not.toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledTimes(1);
    const [payload, loggerContext] = (loggingService.log as jest.Mock).mock
      .calls[0] as [Record<string, unknown>, string];
    expect(loggerContext).toBe(AdminAuditInterceptor.name);
    expect(payload).toMatchObject({
      event: "admin.audit",
      method: "POST",
      path: "/tenants",
      ip: "203.0.113.10",
      statusCode: 201,
      credentialHeader: "x-admin-token",
      adminCredentialFingerprint: expectedFingerprint,
      outcome: "success",
    });
    expect(typeof payload.durationMs).toBe("number");
    expect(typeof payload.recordedAt).toBe("string");
  });

  it("logs warning audit data on error", async () => {
    const loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as LoggingService;
    const interceptor = new AdminAuditInterceptor(loggingService);

    const context = buildContext({
      statusCode: 500,
      headers: { "x-admin-api-key": "api-key-xyz" },
    });
    const next: CallHandler = {
      handle: () => throwError(() => new Error("boom")),
    };

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow("boom");

    expect(loggingService.log).not.toHaveBeenCalled();
    expect(loggingService.warn).toHaveBeenCalledTimes(1);
    const [payload, loggerContext] = (loggingService.warn as jest.Mock).mock
      .calls[0] as [Record<string, unknown>, string];
    expect(loggerContext).toBe(AdminAuditInterceptor.name);
    expect(payload).toMatchObject({
      event: "admin.audit",
      statusCode: 500,
      credentialHeader: "x-admin-api-key",
      outcome: "error",
    });
  });
});
