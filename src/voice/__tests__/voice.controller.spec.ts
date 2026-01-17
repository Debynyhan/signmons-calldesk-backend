import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import request from "supertest";
import { VoiceModule } from "../voice.module";
import appConfig from "../../config/app.config";
import { envValidationSchema } from "../../config/env.validation";
import { TENANTS_SERVICE } from "../../tenants/tenants.constants";
import { PrismaTenantsService } from "../../tenants/tenants.service";
import { ConversationsService } from "../../conversations/conversations.service";
import { CallLogService } from "../../logging/call-log.service";

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
    })
      .overrideProvider(PrismaTenantsService)
      .useValue({ resolveTenantByPhone: jest.fn() })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone: jest.fn() })
      .overrideProvider(ConversationsService)
      .useValue({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid: jest.fn(),
        updateVoiceTranscript: jest.fn(),
      })
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn() })
      .compile();

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
    })
      .overrideProvider(PrismaTenantsService)
      .useValue({ resolveTenantByPhone: jest.fn() })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone: jest.fn() })
      .overrideProvider(ConversationsService)
      .useValue({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid: jest.fn(),
        updateVoiceTranscript: jest.fn(),
      })
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn() })
      .compile();

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

  it("routes inbound calls by To number", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const ensureVoiceConsentConversation = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });

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
    })
      .overrideProvider(PrismaTenantsService)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(ConversationsService)
      .useValue({
        ensureVoiceConsentConversation,
        getVoiceConversationByCallSid: jest.fn(),
        updateVoiceTranscript: jest.fn(),
      })
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn() })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .set("x-request-id", "req-123")
      .send({ To: "12167448929", CallSid: "CA123", From: "2167448929" })
      .expect(200);

    expect(resolveTenantByPhone).toHaveBeenCalledWith("12167448929");
    expect(ensureVoiceConsentConversation).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      callSid: "CA123",
      requestId: "req-123",
      callerPhone: "2167448929",
    });
    expect(response.text).toContain("This call may be transcribed");
    expect(response.text).toContain("<Gather");
    expect(response.text).toContain('input="speech"');
    expect(response.text).toContain('method="POST"');
    expect(response.text).toContain('timeout="5"');
    expect(response.text).toContain('speechTimeout="auto"');

    await app.close();
  });

  it("returns safe TwiML when no tenant matches To number", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue(null);

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
    })
      .overrideProvider(PrismaTenantsService)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(ConversationsService)
      .useValue({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid: jest.fn(),
        updateVoiceTranscript: jest.fn(),
      })
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn() })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .send({ To: "+12167448929" })
      .expect(200);

    expect(resolveTenantByPhone).toHaveBeenCalledWith("+12167448929");
    expect(response.text).toContain("unable to route your call");

    await app.close();
  });

  it("short-circuits voice turn when consent is missing", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: {},
    });

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
    })
      .overrideProvider(PrismaTenantsService)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(ConversationsService)
      .useValue({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript: jest.fn(),
      })
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn() })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({ To: "+12167448929", CallSid: "CA123" })
      .expect(200);

    expect(getVoiceConversationByCallSid).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      callSid: "CA123",
    });
    expect(response.text).toContain("unable to route your call");

    await app.close();
  });

  it("reprompts when no speech result is provided", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: { voiceConsent: { granted: true } },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn();

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
    })
      .overrideProvider(PrismaTenantsService)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(ConversationsService)
      .useValue({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
      })
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({ To: "+12167448929", CallSid: "CA123" })
      .expect(200);

    expect(updateVoiceTranscript).not.toHaveBeenCalled();
    expect(response.text).toContain("Please say that again");
    expect(response.text).toContain("<Gather");

    await app.close();
  });

  it("captures and normalizes speech results", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: { voiceConsent: { granted: true } },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn();

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
    })
      .overrideProvider(PrismaTenantsService)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(ConversationsService)
      .useValue({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
      })
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "  no   heat  ",
        Confidence: "0.78",
      })
      .expect(200);

    expect(updateVoiceTranscript).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      callSid: "CA123",
      transcript: "no heat",
      confidence: 0.78,
    });
    expect(createVoiceTranscriptLog).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      transcript: "no heat",
      confidence: 0.78,
    });
    expect(response.text).toContain("We have captured your response");

    await app.close();
  });

  it("ignores invalid confidence values", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: { voiceConsent: { granted: true } },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn();

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
    })
      .overrideProvider(PrismaTenantsService)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(ConversationsService)
      .useValue({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
      })
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "no heat",
        Confidence: "150",
      })
      .expect(200);

    expect(updateVoiceTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        callSid: "CA123",
        transcript: "no heat",
        confidence: undefined,
      }),
    );
    expect(createVoiceTranscriptLog).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      transcript: "no heat",
      confidence: undefined,
    });

    await app.close();
  });
});
