import type { ExecutionContext } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import type { AppConfig } from "../../config/app.config";
import { TwilioSignatureGuard } from "../twilio-signature.guard";

jest.mock("twilio", () => ({
  validateRequest: jest.fn(),
}));

import { validateRequest } from "twilio";
const mockValidateRequest = validateRequest as jest.MockedFunction<
  typeof validateRequest
>;

const buildConfig = (overrides: Partial<AppConfig> = {}): AppConfig =>
  ({
    environment: "production",
    twilioSignatureCheck: true,
    twilioSignatureAllowInsecureLocal: false,
    twilioAuthToken: "auth-token",
    twilioWebhookBaseUrl: "https://example.ngrok.io",
    ...overrides,
  }) as AppConfig;

const buildContext = (
  headers: Record<string, string> = {},
  body: Record<string, unknown> = {},
  originalUrl = "/api/voice/turn",
): ExecutionContext => {
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
    body,
    originalUrl,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
};

describe("TwilioSignatureGuard", () => {
  beforeEach(() => {
    mockValidateRequest.mockReset();
  });

  it("passes without verification only when local bypass is explicitly enabled", () => {
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const guard = new TwilioSignatureGuard(
      buildConfig({
        environment: "development",
        twilioSignatureAllowInsecureLocal: true,
      }),
    );
    expect(guard.canActivate(buildContext())).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      "Twilio signature verification bypass is enabled for local development.",
    );
    warnSpy.mockRestore();
  });

  it("passes without verification when twilioSignatureCheck is false", () => {
    const guard = new TwilioSignatureGuard(
      buildConfig({ environment: "production", twilioSignatureCheck: false }),
    );
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it("does not bypass verification outside development", () => {
    const guard = new TwilioSignatureGuard(
      buildConfig({
        environment: "test",
        twilioSignatureAllowInsecureLocal: true,
      }),
    );
    expect(() => guard.canActivate(buildContext())).toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when signature header is missing", () => {
    const guard = new TwilioSignatureGuard(buildConfig());
    expect(() => guard.canActivate(buildContext())).toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when baseUrl is not configured", () => {
    const guard = new TwilioSignatureGuard(
      buildConfig({ twilioWebhookBaseUrl: undefined as never }),
    );
    expect(() =>
      guard.canActivate(
        buildContext({ "x-twilio-signature": "sig" }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when signature is invalid", () => {
    mockValidateRequest.mockReturnValue(false);
    const guard = new TwilioSignatureGuard(buildConfig());
    expect(() =>
      guard.canActivate(buildContext({ "x-twilio-signature": "bad-sig" })),
    ).toThrow(UnauthorizedException);
    expect(mockValidateRequest).toHaveBeenCalledWith(
      "auth-token",
      "bad-sig",
      "https://example.ngrok.io/api/voice/turn",
      {},
    );
  });

  it("passes when signature is valid", () => {
    mockValidateRequest.mockReturnValue(true);
    const guard = new TwilioSignatureGuard(buildConfig());
    const result = guard.canActivate(
      buildContext(
        { "x-twilio-signature": "good-sig" },
        { CallSid: "CA123" },
      ),
    );
    expect(result).toBe(true);
    expect(mockValidateRequest).toHaveBeenCalledWith(
      "auth-token",
      "good-sig",
      "https://example.ngrok.io/api/voice/turn",
      { CallSid: "CA123" },
    );
  });

  it("strips trailing slash from baseUrl before building URL", () => {
    mockValidateRequest.mockReturnValue(true);
    const guard = new TwilioSignatureGuard(
      buildConfig({ twilioWebhookBaseUrl: "https://example.ngrok.io/" }),
    );
    guard.canActivate(buildContext({ "x-twilio-signature": "sig" }));
    expect(mockValidateRequest).toHaveBeenCalledWith(
      "auth-token",
      "sig",
      "https://example.ngrok.io/api/voice/turn",
      {},
    );
  });
});
