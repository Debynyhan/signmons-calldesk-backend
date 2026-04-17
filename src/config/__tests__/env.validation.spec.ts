import { envValidationSchema } from "../env.validation";

const BASE_ENV = {
  NODE_ENV: "development",
  OPENAI_API_KEY: "test-openai-key-1234567890",
  ADMIN_API_TOKEN: "dev-admin-token",
};

const validateEnv = (overrides: Record<string, unknown> = {}) =>
  envValidationSchema.validate(
    {
      ...BASE_ENV,
      ...overrides,
    },
    { abortEarly: false },
  );

const hasCustomErrorMessage = (
  error: { details?: Array<{ context?: { message?: string } }> } | undefined,
  needle: string,
): boolean =>
  Boolean(
    error?.details?.some((detail) =>
      String(detail.context?.message ?? "").includes(needle),
    ),
  );

describe("envValidationSchema security rules", () => {
  it("rejects weak admin tokens in production", () => {
    const { error } = validateEnv({
      NODE_ENV: "production",
      ADMIN_API_TOKEN: "changeme-admin-token",
    });
    expect(hasCustomErrorMessage(error, "ADMIN_API_TOKEN")).toBe(true);
  });

  it("allows strong production admin tokens", () => {
    const { error } = validateEnv({
      NODE_ENV: "production",
      ADMIN_API_TOKEN: "prod-7yjw4x3n9b8q2m6k5t1v0z4r",
    });
    expect(error).toBeUndefined();
  });

  it("rejects disabling Twilio signature checks in production", () => {
    const { error } = validateEnv({
      NODE_ENV: "production",
      ADMIN_API_TOKEN: "prod-7yjw4x3n9b8q2m6k5t1v0z4r",
      TWILIO_SIGNATURE_CHECK: "false",
    });
    expect(hasCustomErrorMessage(error, "TWILIO_SIGNATURE_CHECK")).toBe(true);
  });

  it("rejects Twilio insecure-local bypass outside development", () => {
    const { error } = validateEnv({
      NODE_ENV: "test",
      TWILIO_SIGNATURE_ALLOW_INSECURE_LOCAL: "true",
    });
    expect(
      hasCustomErrorMessage(error, "TWILIO_SIGNATURE_ALLOW_INSECURE_LOCAL"),
    ).toBe(true);
  });

  it("allows Twilio insecure-local bypass in development", () => {
    const { error } = validateEnv({
      NODE_ENV: "development",
      TWILIO_SIGNATURE_ALLOW_INSECURE_LOCAL: "true",
    });
    expect(error).toBeUndefined();
  });

  it("rejects Stripe insecure-local bypass outside development", () => {
    const { error } = validateEnv({
      NODE_ENV: "test",
      STRIPE_WEBHOOK_ALLOW_INSECURE_LOCAL: "true",
    });
    expect(
      hasCustomErrorMessage(error, "STRIPE_WEBHOOK_ALLOW_INSECURE_LOCAL"),
    ).toBe(true);
  });

  it("allows Stripe insecure-local bypass in development", () => {
    const { error } = validateEnv({
      NODE_ENV: "development",
      STRIPE_WEBHOOK_ALLOW_INSECURE_LOCAL: "true",
    });
    expect(error).toBeUndefined();
  });
});
