import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import appConfig from "../../config/app.config";
import { envValidationSchema } from "../../config/env.validation";
import { VoiceController } from "../voice.controller";
import { VoiceInboundUseCase } from "../voice-inbound.use-case";
import { TwilioSignatureGuard } from "../twilio-signature.guard";

const validateRequestMock = jest.fn();

jest.mock("twilio", () => ({
  validateRequest: (...args: unknown[]) => validateRequestMock(...args),
}));

const setEnv = (overrides: Record<string, string>) => {
  process.env.NODE_ENV = "test";
  process.env.OPENAI_API_KEY = "test-openai-key-1234567890";
  process.env.ADMIN_API_TOKEN = "prod-7yjw4x3n9b8q2m6k5t1v0z4r";
  process.env.TWILIO_AUTH_TOKEN = "auth-token";
  process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
  process.env.TWILIO_SIGNATURE_CHECK = "true";
  process.env.TWILIO_SIGNATURE_ALLOW_INSECURE_LOCAL = "false";
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
};

const createApp = async (overrides: Record<string, string> = {}) => {
  setEnv(overrides);
  const useCase = {
    handleInbound: jest.fn((_req, res) => res.status(204).send()),
    handleDemoInbound: jest.fn((_req, res) => res.status(204).send()),
    handleTurn: jest.fn((_req, res) => res.status(204).send()),
    handleFallback: jest.fn((_req, res) => res.status(204).send()),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        cache: false,
        load: [appConfig],
        validationSchema: envValidationSchema,
        ignoreEnvFile: true,
      }),
    ],
    controllers: [VoiceController],
    providers: [
      TwilioSignatureGuard,
      {
        provide: VoiceInboundUseCase,
        useValue: useCase,
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, useCase };
};

describe("VoiceController routes", () => {
  beforeEach(() => {
    validateRequestMock.mockReset();
  });

  afterEach(async () => {
    await Promise.resolve();
  });

  const closeApp = async (app: INestApplication) => {
    await app.close();
  };

  it("delegates inbound route when signature checks are disabled", async () => {
    const { app, useCase } = await createApp({ TWILIO_SIGNATURE_CHECK: "false" });

    await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .send({ CallSid: "CA123" })
      .expect(204);

    expect(useCase.handleInbound).toHaveBeenCalledTimes(1);
    await closeApp(app);
  });

  it("rejects inbound requests when signature is missing", async () => {
    const { app, useCase } = await createApp({
      NODE_ENV: "production",
      TWILIO_SIGNATURE_CHECK: "true",
    });

    await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .send({ CallSid: "CA123" })
      .expect(401);

    expect(validateRequestMock).not.toHaveBeenCalled();
    expect(useCase.handleInbound).not.toHaveBeenCalled();
    await closeApp(app);
  });

  it("rejects inbound requests when signature is invalid", async () => {
    validateRequestMock.mockReturnValue(false);
    const { app, useCase } = await createApp({
      NODE_ENV: "production",
      TWILIO_SIGNATURE_CHECK: "true",
    });

    await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .set("x-twilio-signature", "bad-sig")
      .send({ CallSid: "CA123" })
      .expect(401);

    expect(validateRequestMock).toHaveBeenCalledTimes(1);
    expect(useCase.handleInbound).not.toHaveBeenCalled();
    await closeApp(app);
  });

  it("accepts inbound requests when signature is valid", async () => {
    validateRequestMock.mockReturnValue(true);
    const { app, useCase } = await createApp({
      NODE_ENV: "production",
      TWILIO_SIGNATURE_CHECK: "true",
    });

    await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .set("x-twilio-signature", "good-sig")
      .send({ CallSid: "CA123" })
      .expect(204);

    expect(validateRequestMock).toHaveBeenCalledWith(
      "auth-token",
      "good-sig",
      "https://example.ngrok.io/api/voice/inbound",
      expect.objectContaining({ CallSid: "CA123" }),
    );
    expect(useCase.handleInbound).toHaveBeenCalledTimes(1);
    await closeApp(app);
  });

  it("allows explicit local bypass in development", async () => {
    const { app, useCase } = await createApp({
      NODE_ENV: "development",
      TWILIO_SIGNATURE_CHECK: "true",
      TWILIO_SIGNATURE_ALLOW_INSECURE_LOCAL: "true",
    });

    await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .send({ CallSid: "CA123" })
      .expect(204);

    expect(validateRequestMock).not.toHaveBeenCalled();
    expect(useCase.handleInbound).toHaveBeenCalledTimes(1);
    await closeApp(app);
  });
});
