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
import { AddressValidationService } from "../../address/address-validation.service";

const validateRequestMock = jest.fn();

jest.mock("twilio", () => ({
  validateRequest: (...args: unknown[]) => validateRequestMock(...args),
}));

const buildAiService = () => ({
  triage: jest.fn(),
  extractNameCandidate: jest.fn().mockResolvedValue("Dean Banks"),
  extractAddressCandidate: jest
    .fn()
    .mockResolvedValue({ address: "123 Main St Euclid OH 44119", confidence: 0.9 }),
});

const buildConfirmedNameState = () => ({
  candidate: { value: null, sourceEventId: null, createdAt: null },
  confirmed: {
    value: "Dean Banks",
    sourceEventId: "evt-confirmed",
    confirmedAt: new Date().toISOString(),
  },
  status: "CONFIRMED",
  locked: true,
  attemptCount: 0,
});

const buildConfirmedAddressState = () => ({
  candidate: null,
  confirmed: "123 Main St Euclid OH 44119",
  status: "CONFIRMED",
  locked: true,
  attemptCount: 0,
  confidence: 0.9,
  sourceEventId: "evt-address",
});

const buildMissingNameState = () => ({
  candidate: { value: null, sourceEventId: null, createdAt: null },
  confirmed: { value: null, sourceEventId: null, confirmedAt: null },
  status: "MISSING",
  locked: false,
  attemptCount: 0,
});

const buildCandidateNameState = (value: string, sourceEventId: string) => ({
  candidate: {
    value,
    sourceEventId,
    createdAt: new Date().toISOString(),
  },
  confirmed: { value: null, sourceEventId: null, confirmedAt: null },
  status: "CANDIDATE",
  locked: false,
  attemptCount: 0,
});

const buildMissingAddressState = () => ({
  candidate: null,
  confirmed: null,
  status: "MISSING",
  locked: false,
  attemptCount: 0,
});

const buildCandidateAddressState = (value: string, sourceEventId: string) => ({
  candidate: value,
  confirmed: null,
  status: "CANDIDATE",
  locked: false,
  attemptCount: 0,
  sourceEventId,
});

const buildConversationsService = (overrides: Record<string, unknown> = {}) => ({
  ensureVoiceConsentConversation: jest.fn(),
  getVoiceConversationByCallSid: jest.fn(),
  updateVoiceTranscript: jest.fn(),
  getVoiceNameState: jest.fn().mockReturnValue(buildMissingNameState()),
  updateVoiceNameState: jest.fn(),
  getVoiceAddressState: jest.fn().mockReturnValue(buildMissingAddressState()),
  updateVoiceAddressState: jest.fn(),
  updateVoiceIssueCandidate: jest.fn(),
  incrementVoiceTurn: jest.fn().mockResolvedValue({
    conversation: { id: "conversation-1", collectedData: {} },
    voiceTurnCount: 1,
    voiceStartedAt: new Date().toISOString(),
  }),
  updateVoiceListeningWindow: jest.fn(),
  clearVoiceListeningWindow: jest.fn(),
  updateVoiceLastEventId: jest.fn(),
  ...overrides,
});

describe("VoiceController", () => {
  beforeEach(() => {
    validateRequestMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key-1234567890";
    process.env.DATABASE_URL =
      "postgresql://user:pass@localhost:5432/test?schema=calldesk";
    process.env.ADMIN_API_TOKEN = "test-admin-token";
    process.env.DEV_AUTH_ENABLED = "false";
    process.env.ADDRESS_VALIDATION_PROVIDER = "none";
    process.env.VOICE_MAX_TURNS = "6";
    process.env.VOICE_MAX_DURATION_SEC = "180";
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
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid: jest.fn(),
        updateVoiceTranscript: jest.fn(),
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn(), createVoiceAssistantLog: jest.fn() })
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
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid: jest.fn(),
        updateVoiceTranscript: jest.fn(),
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn(), createVoiceAssistantLog: jest.fn() })
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
    const aiService = buildAiService();
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation,
        getVoiceConversationByCallSid: jest.fn(),
        updateVoiceTranscript: jest.fn(),
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn(), createVoiceAssistantLog: jest.fn() })
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
    expect(response.text).toContain("Thank you for calling");
    expect(response.text).toContain("This call may be transcribed");
    expect(response.text).toContain("How may I help you?");
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
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid: jest.fn(),
        updateVoiceTranscript: jest.fn(),
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn(), createVoiceAssistantLog: jest.fn() })
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
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript: jest.fn(),
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog: jest.fn(), createVoiceAssistantLog: jest.fn() })
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

  it("captures issue on the opening turn and then asks for name", async () => {
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
      collectedData: {
        voiceConsent: { granted: true },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const updateVoiceIssueCandidate = jest.fn();

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
      .useValue(buildConversationsService({
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        updateVoiceIssueCandidate,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
      .useValue(buildAiService())
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "My furnace is blowing cold air",
      })
      .expect(200);

    expect(updateVoiceIssueCandidate).toHaveBeenCalled();
    expect(response.text).toContain("May I have your name, please?");

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
      collectedData: {
        voiceConsent: { granted: true },
        name: buildConfirmedNameState(),
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const loggingService = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "reply",
      reply: "Thanks for calling.",
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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

  it("prompts for name confirmation after extracting a candidate", async () => {
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
      collectedData: {
        voiceConsent: { granted: true },
        voiceListeningWindow: {
          field: "name",
          sourceEventId: "evt-2",
          expiresAt: new Date(Date.now() + 5000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const getVoiceNameState = jest.fn().mockReturnValue(buildMissingNameState());
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "My name is Dean Banks",
      })
      .expect(200);

    expect(aiService.extractNameCandidate).not.toHaveBeenCalled();
    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          status: "CANDIDATE",
          candidate: expect.objectContaining({
            value: "Dean Banks",
            sourceEventId: "evt-1",
          }),
        }),
      }),
    );
    expect(aiService.triage).not.toHaveBeenCalled();
    expect(response.text).toContain("I heard Dean Banks");
    expect(response.text).toContain("<Gather");

    await app.close();
  });

  it("falls back to AI extraction when deterministic match fails", async () => {
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
      collectedData: {
        voiceConsent: { granted: true },
        voiceListeningWindow: {
          field: "name",
          sourceEventId: "evt-1",
          expiresAt: new Date(Date.now() + 5000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const getVoiceNameState = jest.fn().mockReturnValue(buildMissingNameState());
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.extractNameCandidate.mockResolvedValue("Dean Banks");

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "hello there",
      })
      .expect(200);

    expect(aiService.extractNameCandidate).toHaveBeenCalledWith(
      "tenant-1",
      "hello there",
    );
    expect(updateVoiceNameState).toHaveBeenCalled();
    expect(response.text).toContain("I heard Dean Banks");

    await app.close();
  });

  it("prompts for spelling after repeated name failures", async () => {
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
      collectedData: {
        voiceConsent: { granted: true },
        voiceListeningWindow: {
          field: "name",
          sourceEventId: "evt-1",
          expiresAt: new Date(Date.now() + 5000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-2");
    const getVoiceNameState = jest.fn().mockReturnValue({
      ...buildMissingNameState(),
      attemptCount: 0,
    });
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.extractNameCandidate.mockResolvedValue(null);

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "uhh",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          status: "MISSING",
          attemptCount: 1,
        }),
      }),
    );
    expect(response.text).toContain("spell your first name");

    await app.close();
  });

  it("locks the name after explicit confirmation", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Dean Banks", "evt-prev"));
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const loggingService = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "correct",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          status: "CANDIDATE",
          locked: true,
          confirmed: expect.objectContaining({
            value: null,
          }),
        }),
        confirmation: expect.objectContaining({
          field: "name",
          value: "Dean Banks",
          sourceEventId: "evt-1",
          channel: "VOICE",
        }),
      }),
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.field_confirmed",
        field: "name",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        callSid: "CA123",
        sourceEventId: "evt-1",
      }),
      VoiceController.name,
    );
    expect(response.text).toContain("Please say your full address.");
    expect(response.text).toContain("<Gather");

    await app.close();
  });

  it("uses soft confirmation when the name is repeated with high confidence", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Dean Banks", "evt-prev"));
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "Dean Banks",
        Confidence: "0.92",
      })
      .expect(200);

    expect(updateVoiceNameState).not.toHaveBeenCalled();
    expect(response.text).toContain("I heard Dean Banks");
    expect(response.text).toContain("<Gather");

    await app.close();
  });

  it("uses hard confirmation when confidence is missing", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Dean Banks", "evt-prev"));
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "Dean Banks",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalled();
    expect(response.text).toContain("I heard Dean Banks");
    expect(response.text).not.toContain("Great, I&apos;ve got");

    await app.close();
  });

  it("clears the candidate name on rejection and re-asks", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-2");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Dean Banks", "evt-prev"));
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "no",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          status: "MISSING",
          attemptCount: 1,
        }),
      }),
    );
    expect(response.text).toContain(
      "Please spell your first name, then say your last name.",
    );

    await app.close();
  });

  it("replaces the candidate when the caller corrects their name", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-2");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Dean Banks", "evt-prev"));
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "No, it's Ben Banks",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          status: "CANDIDATE",
          attemptCount: 1,
          candidate: expect.objectContaining({
            value: "Ben Banks",
            sourceEventId: "evt-2",
          }),
        }),
      }),
    );
    expect(response.text).toContain("I heard Ben Banks");

    await app.close();
  });

  it("reprompts with guidance when confirmation is unclear", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-2");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Dean Banks", "evt-prev"));
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "maybe",
      })
      .expect(200);

    expect(updateVoiceNameState).not.toHaveBeenCalled();
    expect(response.text).toContain(
      "Please say &apos;yes&apos; or say the correct details.",
    );

    await app.close();
  });

  it("does not overwrite confirmed name or address", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const updateVoiceNameState = jest.fn();
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "reply",
      reply: "Thanks for calling.",
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState,
        getVoiceAddressState: jest
          .fn()
          .mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({
        createVoiceTranscriptLog,
        createVoiceAssistantLog: jest.fn(),
      })
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
        SpeechResult: "No, it's Ben Banks",
      })
      .expect(200);

    expect(updateVoiceNameState).not.toHaveBeenCalled();
    expect(updateVoiceAddressState).not.toHaveBeenCalled();
    expect(aiService.triage).toHaveBeenCalled();

    await app.close();
  });

  it("prompts for address confirmation after extracting a candidate", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-1");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest
      .fn()
      .mockReturnValue(buildMissingAddressState());
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.extractAddressCandidate.mockResolvedValue({
      address: "123 Main St",
      confidence: 0.91,
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState,
        updateVoiceAddressState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "My address is 123 Main St",
      })
      .expect(200);

    expect(aiService.extractAddressCandidate).toHaveBeenCalledWith(
      "tenant-1",
      "My address is 123 Main St",
    );
    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          status: "CANDIDATE",
          candidate: "123 Main St",
          sourceEventId: "evt-addr-1",
        }),
      }),
    );
    expect(response.text).toContain("city, state, and ZIP code");
    expect(response.text).toContain("<Gather");

    await app.close();
  });

  it("prompts with the incomplete address message for partial candidates", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-inc");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest
      .fn()
      .mockReturnValue(buildMissingAddressState());
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.extractAddressCandidate.mockResolvedValue({
      address: "20991 reach your a",
      confidence: 0.92,
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState,
        updateVoiceAddressState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
    const addressValidationService = app.get(AddressValidationService);
    const validateSpy = jest.spyOn(
      addressValidationService,
      "validateConfirmedAddress",
    );

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "my address is 20991 reach your a",
      })
      .expect(200);

    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          status: "CANDIDATE",
          attemptCount: 1,
        }),
      }),
    );
    expect(aiService.triage).not.toHaveBeenCalled();
    expect(validateSpy).not.toHaveBeenCalled();
    expect(response.text).toContain("That seems incomplete");
    expect(response.text).toContain("repeat the full street name and city");

    await app.close();
  });

  it("locks the address after explicit confirmation", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-2");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest
      .fn()
      .mockReturnValue(buildCandidateAddressState("123 Main St Euclid OH 44119", "evt-prev"));
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const loggingService = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState,
        updateVoiceAddressState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "yes",
      })
      .expect(200);

    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          status: "CANDIDATE",
          locked: true,
          confirmed: null,
        }),
        confirmation: expect.objectContaining({
          field: "address",
          value: "123 Main St Euclid OH 44119",
          sourceEventId: "evt-addr-2",
          channel: "VOICE",
        }),
      }),
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.field_confirmed",
        field: "address",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        callSid: "CA123",
        sourceEventId: "evt-addr-2",
      }),
      VoiceController.name,
    );
    expect(response.text).toContain(
      "Perfect, thanks for confirming that. Now tell me what&apos;s been going on with the system.",
    );
    expect(response.text).toContain("<Gather");

    await app.close();
  });

  it("uses soft confirmation when the address is repeated with high confidence", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-2");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest
      .fn()
      .mockReturnValue(buildCandidateAddressState("123 Main St Euclid OH 44119", "evt-prev"));
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState,
        updateVoiceAddressState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "123 Main St Euclid OH 44119",
        Confidence: "0.91",
      })
      .expect(200);

    expect(updateVoiceAddressState).not.toHaveBeenCalled();
    expect(response.text).toContain("I heard 123 Main St Euclid OH 44119");
    expect(response.text).toContain("<Gather");

    await app.close();
  });

  it("replaces the candidate when the caller corrects their address", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-2");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest
      .fn()
      .mockReturnValue(buildCandidateAddressState("123 Main St Euclid OH 44119", "evt-prev"));
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState,
        updateVoiceAddressState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "No, it's 20991 Recher Ave Euclid Ohio 44119",
      })
      .expect(200);

    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          status: "CANDIDATE",
          attemptCount: 1,
          candidate: "20991 Recher Ave Euclid Ohio 44119",
          sourceEventId: "evt-addr-2",
        }),
      }),
    );
    expect(response.text).toContain("I heard 20991 Recher Ave Euclid Ohio 44119");

    await app.close();
  });

  it("clears the candidate address on rejection and re-asks", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-3");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest
      .fn()
      .mockReturnValue(buildCandidateAddressState("123 Main St Euclid OH 44119", "evt-prev"));
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState,
        updateVoiceAddressState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "no",
      })
      .expect(200);

    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          status: "MISSING",
          attemptCount: 1,
        }),
      }),
    );
    expect(response.text).toContain("Please say your full service address.");

    await app.close();
  });

  it("fails closed after repeated low-confidence address attempts", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-4");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue({
      ...buildMissingAddressState(),
      attemptCount: 1,
    });
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.extractAddressCandidate.mockResolvedValue({
      address: "123 Main St",
      confidence: 0.2,
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState,
        updateVoiceAddressState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "123 Main St",
      })
      .expect(200);

    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          status: "FAILED",
          attemptCount: 2,
        }),
      }),
    );
    expect(response.text).toContain(
      "Perfect. To make sure everything&apos;s accurate, I&apos;ll send you a quick text to confirm your name and details. Once that&apos;s done, we&apos;ll move forward.",
    );

    await app.close();
  });

  it("returns the same confirmation prompt for duplicate turns", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-3");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Dean Banks", "evt-3"));
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "Dean Banks",
      })
      .expect(200);

    expect(updateVoiceNameState).not.toHaveBeenCalled();
    expect(aiService.extractNameCandidate).not.toHaveBeenCalled();
    expect(response.text).toContain("I heard Dean Banks");

    await app.close();
  });

  it("reprompts for name when listening window expects name", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const activeWindow = {
      field: "name",
      sourceEventId: "evt-prev",
      expiresAt: new Date(Date.now() + 8000).toISOString(),
    };
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: { voiceConsent: { granted: true }, voiceListeningWindow: activeWindow },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: { voiceConsent: { granted: true }, voiceListeningWindow: activeWindow },
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const getVoiceNameState = jest.fn().mockReturnValue({
      candidate: { value: null, sourceEventId: null, createdAt: null },
      confirmed: { value: null, sourceEventId: null, confirmedAt: null },
      status: "MISSING",
      locked: false,
      attemptCount: 0,
    });
    const updateVoiceNameState = jest.fn();
    const getVoiceAddressState = jest.fn().mockReturnValue(buildConfirmedAddressState());
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.extractNameCandidate.mockResolvedValue(null);

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        getVoiceAddressState,
        updateVoiceAddressState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "123 Main St",
      })
      .expect(200);

    expect(updateVoiceAddressState).not.toHaveBeenCalled();
    expect(response.text).toContain("spell your first name");

    await app.close();
  });

  it("includes barge-in on confirmation prompts", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Dean Banks", "evt-1"));
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "Dean Banks",
      })
      .expect(200);

    expect(response.text).toContain('bargeIn="true"');
    expect(response.text).toContain("I heard Dean Banks");

    await app.close();
  });

  it("short-circuits duplicate voice event ids", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const activeWindow = {
      field: "confirmation",
      targetField: "name",
      sourceEventId: "evt-1",
      expiresAt: new Date(Date.now() + 8000).toISOString(),
    };
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: {
        voiceConsent: { granted: true },
        voiceLastEventId: "evt-1",
        voiceListeningWindow: activeWindow,
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: {
        voiceConsent: { granted: true },
        voiceLastEventId: "evt-1",
        voiceListeningWindow: activeWindow,
      },
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Dean Banks", "evt-1"));
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();

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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
        SpeechResult: "Dean Banks",
      })
      .expect(200);

    expect(updateVoiceNameState).not.toHaveBeenCalled();
    expect(response.text).toContain("I heard Dean Banks");

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
      collectedData: {
        voiceConsent: { granted: true },
        name: buildConfirmedNameState(),
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "reply",
      reply: "Thanks for calling.",
    });
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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

  it("suppresses duplicate transcripts within a short window", async () => {
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
      collectedData: {
        voiceConsent: { granted: true },
        lastTranscript: "no heat",
        lastTranscriptAt: new Date(Date.now() - 1000).toISOString(),
        name: buildConfirmedNameState(),
        address: buildConfirmedAddressState(),
      },
    });
    const updateVoiceTranscript = jest.fn();
    const createVoiceTranscriptLog = jest.fn();
    const aiService = buildAiService();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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

    expect(updateVoiceTranscript).not.toHaveBeenCalled();
    expect(createVoiceTranscriptLog).not.toHaveBeenCalled();
    expect(response.text).toContain("Thanks, I heard that.");
    expect(response.text).toContain("<Gather");

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
      collectedData: {
        voiceConsent: { granted: true },
        name: buildConfirmedNameState(),
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "reply",
      reply: "What is your name?",
    });
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
      collectedData: {
        voiceConsent: { granted: true },
        name: buildConfirmedNameState(),
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "job_created",
      message: "Your appointment is booked.",
    });
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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

  it("hangs up when max turns are exceeded", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    process.env.VOICE_MAX_TURNS = "1";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: {
        voiceConsent: { granted: true },
        name: buildConfirmedNameState(),
      },
    });
    const updateVoiceTranscript = jest.fn();
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const aiService = buildAiService();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 2,
      voiceStartedAt: new Date().toISOString(),
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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

    expect(updateVoiceTranscript).not.toHaveBeenCalled();
    expect(response.text).toContain("Thanks for calling");
    expect(response.text).toContain("<Hangup/>");

    await app.close();
  });

  it("hangs up when max duration is exceeded", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    process.env.VOICE_MAX_DURATION_SEC = "30";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: {
        voiceConsent: { granted: true },
        name: buildConfirmedNameState(),
      },
    });
    const updateVoiceTranscript = jest.fn();
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const aiService = buildAiService();
    const startedAt = new Date(Date.now() - 31000).toISOString();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: startedAt,
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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

    expect(updateVoiceTranscript).not.toHaveBeenCalled();
    expect(response.text).toContain("Thanks for calling");
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
      collectedData: {
        voiceConsent: { granted: true },
        name: buildConfirmedNameState(),
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const loggingService = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
    const aiService = buildAiService();
    aiService.triage.mockRejectedValue(
      new BadRequestException("AI refused the request."),
    );
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
      collectedData: {
        voiceConsent: { granted: true },
        name: buildConfirmedNameState(),
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-1");
    const aiService = buildAiService();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
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
      .useValue(buildConversationsService({
        ensureVoiceConsentConversation: jest.fn(),
        getVoiceConversationByCallSid,
        updateVoiceTranscript,
        getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
        updateVoiceAddressState: jest.fn(),
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog: jest.fn() })
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
