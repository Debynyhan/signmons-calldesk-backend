import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import request from "supertest";
import { BadRequestException } from "@nestjs/common";
import { VoiceModule } from "../voice.module";
import { VoiceController } from "../voice.controller";
import appConfig from "../../config/app.config";
import { envValidationSchema } from "../../config/env.validation";
import { TENANTS_SERVICE } from "../../tenants/tenants.constants";
import { PrismaTenantsService } from "../../tenants/tenants.service";
import { ConversationsService } from "../../conversations/conversations.service";
import { CallLogService } from "../../logging/call-log.service";
import { AiService } from "../../ai/ai.service";
import { JobsToolRegistrar } from "../../jobs/tools/jobs-tool.registrar";
import { AI_PROVIDER } from "../../ai/ai.constants";
import { AiErrorHandler } from "../../ai/ai-error.handler";
import { LoggingService } from "../../logging/logging.service";
import { AlertingService } from "../../logging/alerting.service";
import { ToolSelectorService } from "../../ai/tools/tool-selector.service";

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
    const aiService = { triage: jest.fn() };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue({ warn: jest.fn(), error: jest.fn(), log: jest.fn() })
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
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
    const aiService = { triage: jest.fn() };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue({ warn: jest.fn(), error: jest.fn(), log: jest.fn() })
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
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
    const aiService = { triage: jest.fn() };
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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue({ warn: jest.fn(), error: jest.fn(), log: jest.fn() })
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
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
    const aiService = { triage: jest.fn() };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue({ warn: jest.fn(), error: jest.fn(), log: jest.fn() })
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
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
    const aiService = { triage: jest.fn() };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue({ warn: jest.fn(), error: jest.fn(), log: jest.fn() })
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
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
    const loggingService = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
    const aiService = {
      triage: jest.fn().mockResolvedValue({
        status: "reply",
        reply: "Thanks for calling.",
      }),
    };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue(loggingService)
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
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
    const aiService = {
      triage: jest.fn().mockResolvedValue({
        status: "reply",
        reply: "Thanks for calling.",
      }),
    };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue({ warn: jest.fn(), error: jest.fn(), log: jest.fn() })
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
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
      occurredAt: expect.any(Date),
    });
    expect(aiService.triage).toHaveBeenCalledWith(
      "tenant-1",
      "CA123",
      "no heat",
      expect.objectContaining({
        conversationId: "conversation-1",
        channel: expect.any(String),
      }),
    );
    expect(response.text).toContain("Thanks for calling.");
    expect(response.text).toContain("<Hangup/>");
    expect(response.text).not.toContain("<Gather");

    await app.close();
  });

  it("appends Gather when the AI reply asks a question", async () => {
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
    const aiService = {
      triage: jest.fn().mockResolvedValue({
        status: "reply",
        reply: "What is your name?",
      }),
    };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue({ warn: jest.fn(), error: jest.fn(), log: jest.fn() })
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "no heat",
      })
      .expect(200);

    expect(response.text).toContain("What is your name?");
    expect(response.text).toContain("<Gather");
    expect(response.text).not.toContain("<Hangup/>");

    await app.close();
  });

  it("ends the call on job creation", async () => {
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
    const aiService = {
      triage: jest.fn().mockResolvedValue({
        status: "job_created",
        message: "Your appointment is booked.",
      }),
    };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue({ warn: jest.fn(), error: jest.fn(), log: jest.fn() })
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "no heat",
      })
      .expect(200);

    expect(response.text).toContain("Your appointment is booked.");
    expect(response.text).toContain("<Hangup/>");

    await app.close();
  });

  it("returns safe TwiML when AI triage fails", async () => {
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
    const loggingService = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
    const aiService = {
      triage: jest
        .fn()
        .mockRejectedValue(new BadRequestException("AI refused the request.")),
    };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue(loggingService)
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "no heat",
        Confidence: "0.78",
      })
      .expect(200);

    expect(aiService.triage).toHaveBeenCalled();
    expect(response.text).toContain(
      "We&apos;re having trouble handling your call",
    );
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.preview_fallback",
        tenantId: "tenant-1",
        callSid: "CA123",
        conversationId: "conversation-1",
      }),
      VoiceController.name,
    );

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
    const aiService = { triage: jest.fn() };

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
      .overrideProvider(JobsToolRegistrar)
      .useValue({ onModuleInit: jest.fn() })
      .overrideProvider(AI_PROVIDER)
      .useValue({ createCompletion: jest.fn() })
      .overrideProvider(ToolSelectorService)
      .useValue({ getEnabledToolsForTenant: jest.fn().mockReturnValue([]) })
      .overrideProvider(AiErrorHandler)
      .useValue({ handle: jest.fn() })
      .overrideProvider(LoggingService)
      .useValue({ warn: jest.fn(), error: jest.fn(), log: jest.fn() })
      .overrideProvider(AlertingService)
      .useValue({ notifyCritical: jest.fn() })
      .overrideProvider(AiService)
      .useValue(aiService)
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
      occurredAt: expect.any(Date),
    });

    await app.close();
  });
});
