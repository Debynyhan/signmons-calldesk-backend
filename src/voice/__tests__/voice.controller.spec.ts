import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import request from "supertest";
import { VoiceModule } from "../voice.module";
import appConfig from "../../config/app.config";
import { envValidationSchema } from "../../config/env.validation";

const validateRequestMock = jest.fn();

jest.mock("twilio", () => ({
  validateRequest: (...args: unknown[]) => validateRequestMock(...args),
}));

describe("VoiceController", () => {
  beforeEach(() => {
    validateRequestMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key-1234567890";
    process.env.DATABASE_URL =
      "postgresql://user:pass@localhost:5432/test?schema=calldesk";
    process.env.ADMIN_API_TOKEN = "test-admin-token";
  });

  it("rejects invalid signatures when enabled in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_PHONE_NUMBER = "+12167448929";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(false);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          load: [appConfig],
          validationSchema: envValidationSchema,
          ignoreEnvFile: true,
        }),
        VoiceModule,
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .set("x-twilio-signature", "bad-signature")
      .send({ CallSid: "CA123" })
      .expect(401);

    await app.close();
  });

  it("returns disabled TwiML when voice is disabled", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "false";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          load: [appConfig],
          validationSchema: envValidationSchema,
          ignoreEnvFile: true,
        }),
        VoiceModule,
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .send({ CallSid: "CA123" })
      .expect(200);

    expect(response.text).toContain("Voice intake is currently unavailable.");
    expect(response.text).toContain("<Response>");
    expect(response.header["content-type"]).toContain("text/xml");

    await app.close();
  });
});
