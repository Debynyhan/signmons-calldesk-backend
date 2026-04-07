import { Test, type TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import request from "supertest";
import { BadRequestException } from "@nestjs/common";
import { WsAdapter } from "@nestjs/platform-ws";
import { VoiceModule } from "../voice.module";
import { VoiceTurnService } from "../voice-turn.service";
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
import { VoiceConsentAudioService } from "../voice-consent-audio.service";

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
  corrections: 0,
  lastConfidence: null,
  spellPromptedAt: null,
  spellPromptedTurnIndex: null,
  spellPromptCount: 0,
  firstNameSpelled: null,
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
  corrections: 0,
  lastConfidence: null,
  spellPromptedAt: null,
  spellPromptedTurnIndex: null,
  spellPromptCount: 0,
  firstNameSpelled: null,
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
  corrections: 0,
  lastConfidence: null,
  spellPromptedAt: null,
  spellPromptedTurnIndex: null,
  spellPromptCount: 0,
  firstNameSpelled: null,
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

const buildSmsPhoneState = (value: string | null, confirmed = false) => ({
  value,
  source: value ? "twilio_ani" : null,
  confirmed,
  confirmedAt: confirmed ? new Date().toISOString() : null,
  attemptCount: 0,
  lastPromptedAt: null,
});

const buildDefaultComfortRisk = () => ({
  askedAt: null,
  response: "NO",
  sourceEventId: null,
});

const buildDefaultUrgencyConfirmation = () => ({
  askedAt: null,
  response: "NO",
  sourceEventId: null,
});

const buildConversationsService = (overrides: Record<string, unknown> = {}) => ({
  ensureVoiceConsentConversation: jest.fn(),
  getVoiceConversationByCallSid: jest.fn(),
  getConversationById: jest.fn().mockResolvedValue({
    id: "conversation-1",
    collectedData: {},
  }),
  updateVoiceTranscript: jest.fn(),
  getVoiceNameState: jest.fn().mockReturnValue(buildMissingNameState()),
  updateVoiceNameState: jest.fn(),
  getVoiceSmsPhoneState: jest
    .fn()
    .mockReturnValue(buildSmsPhoneState(null, false)),
  updateVoiceSmsPhoneState: jest.fn(),
  getVoiceSmsHandoff: jest.fn().mockReturnValue(null),
  updateVoiceSmsHandoff: jest.fn(),
  clearVoiceSmsHandoff: jest.fn(),
  getVoiceAddressState: jest.fn().mockReturnValue(buildMissingAddressState()),
  updateVoiceAddressState: jest.fn(),
  getVoiceComfortRisk: jest.fn().mockReturnValue(buildDefaultComfortRisk()),
  updateVoiceComfortRisk: jest.fn(),
  getVoiceUrgencyConfirmation: jest
    .fn()
    .mockReturnValue(buildDefaultUrgencyConfirmation()),
  updateVoiceUrgencyConfirmation: jest.fn(),
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

const createTestApp = async (moduleRef: TestingModule) => {
  const app = moduleRef.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init();
  return app;
};

describe("VoiceController", () => {
  beforeEach(() => {
    validateRequestMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key-1234567890";
    process.env.DATABASE_URL =
      "postgresql://user:pass@localhost:5432/test?schema=calldesk";
    process.env.ADMIN_API_TOKEN = "test-admin-token";
    process.env.DEV_AUTH_ENABLED = "false";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
    process.env.TWILIO_PHONE_NUMBER = "+12167448929";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    process.env.ADDRESS_VALIDATION_PROVIDER = "none";
    process.env.VOICE_MAX_TURNS = "6";
    process.env.VOICE_MAX_DURATION_SEC = "180";
    process.env.VOICE_STREAMING_ENABLED = "false";
    process.env.VOICE_STREAMING_KEEPALIVE_SEC = "60";
    process.env.VOICE_STREAMING_TRACK = "inbound";
    process.env.GOOGLE_SPEECH_ENABLED = "false";
    process.env.GOOGLE_TTS_ENABLED = "false";
    process.env.VOICE_STT_PROVIDER = "";
    process.env.VOICE_TTS_PROVIDER = "";
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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

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

  it("returns streaming TwiML on inbound when Google STT is enabled", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    process.env.VOICE_STREAMING_ENABLED = "true";
    process.env.VOICE_STREAMING_KEEPALIVE_SEC = "30";
    process.env.VOICE_STT_PROVIDER = "google";
    process.env.GOOGLE_SPEECH_ENABLED = "true";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      voiceNumber: "+12167448929",
    });
    const ensureVoiceConsentConversation = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const voiceConsentAudioService = {
      getCachedConsentUrl: jest.fn().mockResolvedValue(null),
      warmConsentAudio: jest.fn(),
    };
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
      .overrideProvider(VoiceConsentAudioService)
      .useValue(voiceConsentAudioService)
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/inbound")
      .set("x-request-id", "req-123")
      .send({ To: "12167448929", CallSid: "CA123", From: "2167448929" })
      .expect(200);

    expect(ensureVoiceConsentConversation).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      callSid: "CA123",
      requestId: "req-123",
      callerPhone: "2167448929",
    });
    expect(voiceConsentAudioService.getCachedConsentUrl).toHaveBeenCalledWith(
      "tenant-1",
      expect.any(String),
    );
    expect(voiceConsentAudioService.warmConsentAudio).toHaveBeenCalledWith(
      "tenant-1",
      expect.any(String),
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.streaming_inbound_selected",
        tenantId: "tenant-1",
        callSid: "CA123",
      }),
      expect.any(String),
    );
    expect(response.text).toContain(
      '<Start><Stream url="wss://example.ngrok.io/api/voice/stream"',
    );
    expect(response.text).toContain(
      '<Parameter name="tenantId" value="tenant-1"/>',
    );
    expect(response.text).toContain("<Say>");
    expect(response.text).toContain("<Pause length=\"30\"/>");
    expect(response.text).not.toContain("<Gather");

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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "My furnace is blowing cold air",
      })
      .expect(200);

    expect(updateVoiceIssueCandidate).toHaveBeenCalled();
    expect(response.text).toContain("What&apos;s your full name?");

    await app.close();
  });

  it("uses a multi-field recovery prompt when the opening utterance is greeting-only", async () => {
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Hello.",
      })
      .expect(200);

    expect(updateVoiceIssueCandidate).not.toHaveBeenCalled();
    expect(response.text).toContain(
      "Please say your full name and briefly what&apos;s going on with the system.",
    );

    await app.close();
  });

  it("captures service-request phrasing as an issue on the opening turn", async () => {
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "I need someone to come check this today.",
      })
      .expect(200);

    expect(updateVoiceIssueCandidate).toHaveBeenCalled();
    expect(response.text).toContain("What&apos;s your full name?");

    await app.close();
  });

  it("captures name and issue on the opening turn and moves to address", async () => {
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
    const updateVoiceNameState = jest.fn();

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
        updateVoiceNameState,
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult:
          "Hey, this is Ben Banks. My furnace is blowing cold air.",
      })
      .expect(200);

    expect(updateVoiceIssueCandidate).toHaveBeenCalled();
    expect(updateVoiceNameState).toHaveBeenCalled();
    expect(response.text).toMatch(
      /Please say the service address|If that&apos;s right, say &apos;yes&apos;/,
    );

    await app.close();
  });

  it("confirms a name after an issue is captured without a listening window", async () => {
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
        issueCandidate: { value: "My furnace is blowing cold air", sourceEventId: "evt-1" },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-2");
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Training Banks.",
      })
      .expect(200);

    expect(aiService.extractNameCandidate).not.toHaveBeenCalled();
    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          status: "CANDIDATE",
          attemptCount: 1,
          candidate: expect.objectContaining({
            value: "Training Banks",
          }),
        }),
      }),
    );
    expect(response.text).toContain("Thanks, Training.");
    expect(response.text).toContain("Please say the service address.");

    await app.close();
  });

  it("captures issue during name collection and then asks for name", async () => {
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
    const updateVoiceIssueCandidate = jest.fn();
    const updateVoiceNameState = jest.fn();
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
        updateVoiceIssueCandidate,
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
      .useValue(buildAiService())
      .compile();

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "My furnace went out and it's a blizzard outside.",
      })
      .expect(200);

    expect(updateVoiceIssueCandidate).toHaveBeenCalled();
    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          attemptCount: 1,
          status: "MISSING",
        }),
      }),
    );
    expect(response.text).toContain("What&apos;s your full name?");

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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

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
          attemptCount: 1,
          candidate: expect.objectContaining({
            value: "Dean Banks",
            sourceEventId: "evt-1",
          }),
        }),
      }),
    );
    expect(aiService.triage).not.toHaveBeenCalled();
    expect(response.text).toContain("Thanks, Dean.");
    expect(response.text).toContain("Please say the service address.");
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

    const app = await createTestApp(moduleRef);

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
    expect(response.text).toContain("Thanks, Dean.");
    expect(response.text).toContain("Please say the service address.");

    await app.close();
  });

  it("answers side questions during name collection and reprompts for name", async () => {
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
    const updateVoiceNameState = jest.fn();
    const createVoiceAssistantLog = jest.fn();
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
        updateVoiceNameState,
        incrementVoiceTurn,
      }))
      .overrideProvider(CallLogService)
      .useValue({ createVoiceTranscriptLog, createVoiceAssistantLog })
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Yes, how you doing?",
      })
      .expect(200);

    expect(updateVoiceNameState).not.toHaveBeenCalled();
    expect(aiService.extractNameCandidate).not.toHaveBeenCalled();
    expect(response.text).toContain("I&apos;m doing well, thanks for asking.");
    expect(response.text).toContain("What&apos;s your full name?");

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
      ...buildCandidateNameState("Dean Banks", "evt-prev"),
      corrections: 2,
      lastConfidence: 0.92,
      attemptCount: 1,
    });
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 2,
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "uhh",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalled();
    expect(response.text).toContain("how do you spell your first name");

    await app.close();
  });

  it("accepts spelled first name and moves on to address", async () => {
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
      ...buildCandidateNameState("Dean Banks", "evt-prev"),
      spellPromptedAt: Date.now() - 2000,
      spellPromptedTurnIndex: 1,
      spellPromptCount: 1,
    });
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 2,
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "D E I O N Banks",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          candidate: expect.objectContaining({
            value: "Deion Banks",
          }),
          firstNameSpelled: "Deion",
        }),
      }),
    );
    expect(response.text).toContain("Thanks, Deion.");
    expect(response.text).toContain("Please say the service address.");

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
      collectedData: {
        voiceConsent: { granted: true },
        issueCandidate: {
          value: "The furnace is blowing cold air",
          sourceEventId: "evt-issue",
        },
      },
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

    const app = await createTestApp(moduleRef);

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
          locked: true,
          status: "CANDIDATE",
        }),
      }),
    );
    expect(response.text).toContain("Thanks, Dean.");
    expect(response.text).toContain("Please say the service address.");
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Dean Banks",
        Confidence: "0.92",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          locked: true,
          status: "CANDIDATE",
        }),
      }),
    );
    expect(response.text).toContain("Thanks, Dean.");
    expect(response.text).toContain("Please say the service address.");
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Dean Banks",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          locked: true,
          status: "CANDIDATE",
        }),
      }),
    );
    expect(response.text).toContain("Thanks, Dean.");
    expect(response.text).toContain("Please say the service address.");

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

    const app = await createTestApp(moduleRef);

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
          locked: true,
          status: "CANDIDATE",
        }),
      }),
    );
    expect(response.text).toContain("Thanks, Dean.");
    expect(response.text).toContain("Please say the service address.");

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

    const app = await createTestApp(moduleRef);

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
    expect(response.text).toContain("Thanks, Ben.");
    expect(response.text).toContain("Please say the service address.");

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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "maybe",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          locked: true,
          status: "CANDIDATE",
        }),
      }),
    );
    expect(response.text).toContain("Thanks, Dean.");
    expect(response.text).toContain("Please say the service address.");

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

    const app = await createTestApp(moduleRef);

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
    expect(aiService.triage).not.toHaveBeenCalled();

    await app.close();
  });

  it("prompts for address confirmation after deterministic address capture", async () => {
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "My address is 123 Main St",
      })
      .expect(200);

    expect(aiService.extractAddressCandidate).not.toHaveBeenCalled();
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
    expect(response.text).toContain("city and state");
    expect(response.text).toContain("<Gather");

    await app.close();
  });

  it("captures address input when name is still candidate and no listening window is active", async () => {
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
        issueCandidate: {
          value: "My furnace is out.",
          sourceEventId: "evt-issue",
          createdAt: new Date().toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-5");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue({ ...buildCandidateNameState("Debynyhan", "evt-name"), attemptCount: 1 });
    const getVoiceAddressState = jest
      .fn()
      .mockReturnValue(buildMissingAddressState());
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 3,
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "20991 Reacher Avenue Euclid Ohio 44119",
      })
      .expect(200);

    expect(aiService.extractAddressCandidate).not.toHaveBeenCalled();
    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          status: "CANDIDATE",
          candidate: expect.stringContaining("20991"),
          sourceEventId: "evt-addr-5",
        }),
      }),
    );
    expect(response.text).toContain("If that&apos;s right, say &apos;yes&apos;");
    expect(response.text).not.toContain("Please say the service address.");

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

    const app = await createTestApp(moduleRef);
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

    expect(aiService.extractAddressCandidate).toHaveBeenCalledWith(
      "tenant-1",
      "my address is 20991 reach your a",
    );
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
    expect(response.text).toMatch(
      /That seems incomplete|What&apos;s the street address\?/,
    );

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

    const app = await createTestApp(moduleRef);
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
      VoiceTurnService.name,
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

    const app = await createTestApp(moduleRef);
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

    const app = await createTestApp(moduleRef);
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

  it("treats restating the same address as confirmation", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-same");
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Yes, it's 123 Main St Euclid OH 44119",
      })
      .expect(200);

    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          candidate: "123 Main St Euclid OH 44119",
          locked: true,
          attemptCount: 0,
          sourceEventId: "evt-addr-same",
        }),
        confirmation: expect.objectContaining({
          field: "address",
          value: "123 Main St Euclid OH 44119",
        }),
      }),
    );
    expect(response.text).toContain("Perfect, thanks for confirming that.");
    expect(response.text).toContain("what&apos;s been going on with the system");

    await app.close();
  });

  it("routes late yes/no to address confirmation even when name is still candidate", async () => {
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
          field: "confirmation",
          targetField: "address",
          sourceEventId: "evt-prev",
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-late-confirm");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Ben Banks", "evt-name-prev"));
    const getVoiceAddressState = jest
      .fn()
      .mockReturnValue(
        buildCandidateAddressState("20991 Reacher Avenue Euclid Ohio 44119", "evt-prev"),
      );
    const updateVoiceAddressState = jest.fn();
    const updateVoiceNameState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 2,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Yes",
      })
      .expect(200);

    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          candidate: "20991 Reacher Avenue Euclid Ohio 44119",
          locked: true,
          sourceEventId: "evt-late-confirm",
        }),
        confirmation: expect.objectContaining({
          field: "address",
          value: "20991 Reacher Avenue Euclid Ohio 44119",
        }),
      }),
    );
    expect(updateVoiceNameState).not.toHaveBeenCalled();
    expect(response.text).toContain("Perfect, thanks for confirming that.");

    await app.close();
  });

  it("prioritizes pending address confirmation over stale comfort-risk yes/no handling", async () => {
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
          field: "confirmation",
          targetField: "address",
          sourceEventId: "evt-address-q",
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-late-yes");
    const getVoiceNameState = jest
      .fn()
      .mockReturnValue(buildCandidateNameState("Ben Banks", "evt-name-prev"));
    const getVoiceAddressState = jest
      .fn()
      .mockReturnValue(
        buildCandidateAddressState("20991 Reeder Avenue Euclid Ohio 44119", "evt-address-q"),
      );
    const getVoiceComfortRisk = jest.fn().mockReturnValue({
      askedAt: new Date(Date.now() - 20_000).toISOString(),
      response: null,
      sourceEventId: "evt-comfort-q",
    });
    const getVoiceUrgencyConfirmation = jest.fn().mockReturnValue({
      askedAt: null,
      response: null,
      sourceEventId: null,
    });
    const updateVoiceUrgencyConfirmation = jest.fn();
    const updateVoiceAddressState = jest.fn();
    const updateVoiceComfortRisk = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 4,
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
        getVoiceComfortRisk,
        updateVoiceComfortRisk,
        getVoiceUrgencyConfirmation,
        updateVoiceUrgencyConfirmation,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Yes",
      })
      .expect(200);

    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          candidate: "20991 Reeder Avenue Euclid Ohio 44119",
          locked: true,
          sourceEventId: "evt-late-yes",
        }),
        confirmation: expect.objectContaining({
          field: "address",
          value: "20991 Reeder Avenue Euclid Ohio 44119",
        }),
      }),
    );
    expect(updateVoiceComfortRisk).not.toHaveBeenCalled();
    expect(updateVoiceUrgencyConfirmation).not.toHaveBeenCalled();
    expect(response.text).toContain("Perfect, thanks for confirming that.");
    expect(response.text).not.toContain("mark it urgent");

    await app.close();
  });

  it("routes late urgency yes straight to sms handoff when issue is already captured", async () => {
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
        issueCandidate: {
          value: "The furnace is blowing cold air",
          sourceEventId: "evt-issue",
        },
        voiceListeningWindow: {
          field: "confirmation",
          targetField: "urgency_confirm",
          sourceEventId: "evt-urgency-q",
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-urgency-late");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue(buildConfirmedAddressState());
    const getVoiceComfortRisk = jest.fn().mockReturnValue({
      askedAt: new Date(Date.now() - 20_000).toISOString(),
      response: "YES",
      sourceEventId: "evt-comfort-q",
    });
    const getVoiceUrgencyConfirmation = jest.fn().mockReturnValue({
      askedAt: new Date(Date.now() - 15_000).toISOString(),
      response: null,
      sourceEventId: "evt-urgency-q",
    });
    const updateVoiceUrgencyConfirmation = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 5,
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
        updateVoiceAddressState: jest.fn(),
        getVoiceComfortRisk,
        getVoiceUrgencyConfirmation,
        updateVoiceUrgencyConfirmation,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Yes",
      })
      .expect(200);

    expect(updateVoiceUrgencyConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        urgencyConfirmation: expect.objectContaining({
          response: "YES",
          sourceEventId: "evt-urgency-late",
        }),
      }),
    );
    expect(aiService.triage).not.toHaveBeenCalled();
    expect(response.text).toContain("best number to text updates");
    expect(response.text).not.toContain("How can I help?");
    expect(response.text).not.toContain("confirm your name");

    await app.close();
  });

  it("treats 'that's perfect' as callback confirmation yes", async () => {
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
          field: "confirmation",
          targetField: "callback",
          sourceEventId: "evt-callback-q",
          expiresAt: new Date(Date.now() + 5000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue(
      "evt-callback-yes",
    );
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 2,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "That's perfect.",
      })
      .expect(200);

    expect(response.text).toContain("We&apos;ll call you back shortly.");
    expect(response.text).toContain("<Hangup/>");
    expect(aiService.triage).not.toHaveBeenCalled();

    await app.close();
  });

  it("treats 'yellow' as callback confirmation yes", async () => {
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
          field: "confirmation",
          targetField: "callback",
          sourceEventId: "evt-callback-q",
          expiresAt: new Date(Date.now() + 5000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue(
      "evt-callback-yellow",
    );
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 2,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Yellow.",
      })
      .expect(200);

    expect(response.text).toContain("We&apos;ll call you back shortly.");
    expect(response.text).toContain("<Hangup/>");
    expect(aiService.triage).not.toHaveBeenCalled();

    await app.close();
  });

  it("captures name and issue together on first turn and advances to next missing slot", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-first");
    const getVoiceNameState = jest.fn().mockReturnValue(buildMissingNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue(buildMissingAddressState());
    const getVoiceComfortRisk = jest.fn().mockReturnValue({
      askedAt: null,
      response: null,
      sourceEventId: null,
    });
    const updateVoiceNameState = jest.fn();
    const getVoiceUrgencyConfirmation = jest.fn().mockReturnValue({
      askedAt: null,
      response: null,
      sourceEventId: null,
    });
    const updateVoiceUrgencyConfirmation = jest.fn();
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
        getVoiceAddressState,
        getVoiceComfortRisk,
        getVoiceUrgencyConfirmation,
        updateVoiceAddressState: jest.fn(),
        updateVoiceUrgencyConfirmation,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Hey, this is Ben Banks. My furnace is blowing cold air.",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          candidate: expect.objectContaining({
            value: "Ben Banks",
            sourceEventId: "evt-first",
          }),
          locked: true,
        }),
      }),
    );
    expect(updateVoiceUrgencyConfirmation).not.toHaveBeenCalled();
    expect(response.text).toMatch(
      /Please say the service address|If that&apos;s right, say &apos;yes&apos;/,
    );
    expect(response.text).not.toContain("What&apos;s your full name?");
    expect(aiService.triage).not.toHaveBeenCalled();

    await app.close();
  });

  it("maps legacy comfort-risk window replies into emergency confirmation", async () => {
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
        issueCandidate: {
          value: "Furnace is blowing cold air",
          sourceEventId: "evt-issue",
        },
        voiceListeningWindow: {
          field: "confirmation",
          targetField: "comfort_risk",
          sourceEventId: "evt-comfort-q",
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue(
      "evt-comfort-no",
    );
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue(buildConfirmedAddressState());
    const updateVoiceUrgencyConfirmation = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 2,
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
        updateVoiceAddressState: jest.fn(),
        updateVoiceUrgencyConfirmation,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "There's no elderly or kids in our house.",
      })
      .expect(200);

    expect(updateVoiceUrgencyConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        urgencyConfirmation: expect.objectContaining({
          response: "NO",
          sourceEventId: "evt-comfort-no",
        }),
      }),
    );
    expect(response.text).toContain("best number to text updates");
    expect(aiService.triage).not.toHaveBeenCalled();

    await app.close();
  });

  it("bypasses ai issue re-ask when issue is already captured", async () => {
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
        issueCandidate: {
          value: "Furnace blowing cold air",
          sourceEventId: "evt-issue",
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue(
      "evt-issue-guard",
    );
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue(buildConfirmedAddressState());
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 3,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "reply",
      reply: "Can you please provide a brief description of the issue?",
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
        updateVoiceAddressState: jest.fn(),
        getVoiceComfortRisk: jest.fn().mockReturnValue(buildDefaultComfortRisk()),
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Yes",
      })
      .expect(200);

    expect(aiService.triage).toHaveBeenCalledTimes(1);
    expect(response.text).toContain("best number to text updates");
    expect(response.text).not.toContain("brief description of the issue");

    await app.close();
  });

  it("normalizes ai issue re-ask when issue is still missing", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue(
      "evt-issue-missing-guard",
    );
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue(buildConfirmedAddressState());
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 3,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "reply",
      reply: "Can you please provide a brief description of the issue?",
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Can you help me with this today?",
      })
      .expect(200);

    expect(aiService.triage).toHaveBeenCalledTimes(1);
    expect(response.text).toContain("main issue, like no heat or leaking water");
    expect(response.text).not.toContain("brief description of the issue");

    await app.close();
  });

  it("captures freeform issue phrasing once and skips issue reprompt", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      name: "Acme HVAC",
      voiceNumber: "+12167448929",
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: { voiceConsent: { granted: true } },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-freeform-issue");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue(buildConfirmedAddressState());
    const updateVoiceIssueCandidate = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 4,
      voiceStartedAt: new Date().toISOString(),
    });
    const getConversationById = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: { callerPhone: "+12167448929" },
    });
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "reply",
      reply: "Can you please provide a brief description of the issue?",
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
        getConversationById,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState,
        updateVoiceAddressState: jest.fn(),
        updateVoiceIssueCandidate,
        getVoiceSmsPhoneState: jest
          .fn()
          .mockReturnValue(buildSmsPhoneState("+12167448929", false)),
        updateVoiceSmsPhoneState: jest.fn(),
        clearVoiceSmsHandoff: jest.fn(),
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "My unit keeps short cycling every few minutes.",
      })
      .expect(200);

    expect(aiService.triage).toHaveBeenCalledTimes(1);
    expect(updateVoiceIssueCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        issue: expect.objectContaining({
          value: expect.stringContaining("short cycling"),
        }),
      }),
    );
    expect(response.text).toContain("I&apos;m texting you now");
    expect(response.text).not.toContain("main issue, like no heat or leaking water");
    expect(response.text).not.toContain("brief description of the issue");

    await app.close();
  });

  it("continues intake on frustration when issue is already captured", async () => {
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
        issueCandidate: {
          value: "Furnace blowing cold air",
          sourceEventId: "evt-issue",
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue(
      "evt-frustration-continue",
    );
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue(buildConfirmedAddressState());
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 3,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "You keep repeating yourself.",
      })
      .expect(200);

    expect(aiService.triage).not.toHaveBeenCalled();
    expect(response.text).toContain("best number to text updates");
    expect(response.text).not.toContain("dispatcher call you back");

    await app.close();
  });

  it("defer issue capture to sms after one failed issue reprompt", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      name: "Acme HVAC",
      voiceNumber: "+12167448929",
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: { voiceConsent: { granted: true } },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest
      .fn()
      .mockResolvedValueOnce("evt-issue-miss-1")
      .mockResolvedValueOnce("evt-issue-miss-2");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue(buildConfirmedAddressState());
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 4,
      voiceStartedAt: new Date().toISOString(),
    });
    const getConversationById = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: { callerPhone: "+12167448929" },
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
        getConversationById,
        updateVoiceTranscript,
        getVoiceNameState,
        updateVoiceNameState: jest.fn(),
        getVoiceAddressState,
        updateVoiceAddressState: jest.fn(),
        getVoiceSmsPhoneState: jest
          .fn()
          .mockReturnValue(buildSmsPhoneState("+12167448929", false)),
        updateVoiceSmsPhoneState: jest.fn(),
        clearVoiceSmsHandoff: jest.fn(),
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

    const app = await createTestApp(moduleRef);

    const first = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "hello",
      })
      .expect(200);
    expect(first.text).toContain("main issue, like no heat or leaking water");

    const second = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "hello",
      })
      .expect(200);
    expect(second.text).toContain("service fee");
    expect(second.text).toContain("I&apos;m texting you now");
    expect(second.text).not.toContain("main issue, like no heat or leaking water");

    await app.close();
  });

  it("reprompts for issue details instead of callback when caller says they already told us", async () => {
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
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-repeat-issue");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue(buildConfirmedAddressState());
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 4,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "I told you already",
      })
      .expect(200);

    expect(aiService.triage).not.toHaveBeenCalled();
    expect(response.text).toContain("main issue, like no heat or leaking water");
    expect(response.text).not.toContain("dispatcher call you back");

    await app.close();
  });

  it("accepts zip-only locality while awaiting address confirmation", async () => {
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
          field: "confirmation",
          targetField: "address",
          sourceEventId: "evt-prev",
          expiresAt: new Date(Date.now() + 5000).toISOString(),
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-addr-zip");
    const getVoiceNameState = jest.fn().mockReturnValue(buildConfirmedNameState());
    const getVoiceAddressState = jest.fn().mockReturnValue({
      ...buildCandidateAddressState("20991 Reacher Avenue Euclid Ohio", "evt-prev"),
      houseNumber: "20991",
      street: "Reacher Avenue",
      city: "Euclid",
      state: "Ohio",
      zip: null,
      needsLocality: false,
    });
    const updateVoiceAddressState = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 2,
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

    const app = await createTestApp(moduleRef);
    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "44119",
      })
      .expect(200);

    expect(updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        addressState: expect.objectContaining({
          candidate: expect.stringContaining("44119"),
          zip: "44119",
          sourceEventId: "evt-addr-zip",
        }),
      }),
    );
    expect(response.text).toContain("If that&apos;s right, say &apos;yes&apos;");

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

    const app = await createTestApp(moduleRef);

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
    expect(response.text).toContain("What&apos;s the service address?");

    await app.close();
  });

  it("moves on after repeated low-confidence address attempts", async () => {
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

    const app = await createTestApp(moduleRef);

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
          smsConfirmNeeded: true,
        }),
      }),
    );
    expect(response.text).toContain(
      "confirm the address by text after we finish",
    );

    await app.close();
  });

  it("includes fees in SMS handoff once intake is complete", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      name: "Leizurely HVAC",
      voiceNumber: "+12167448929",
    });
    const getTenantFeePolicy = jest.fn().mockResolvedValue({
      id: "fee-policy-1",
      tenantId: "tenant-1",
      serviceFeeCents: 8900,
      emergencyFeeCents: 15000,
      creditWindowHours: 24,
      currency: "USD",
      effectiveAt: new Date().toISOString(),
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: {
        voiceConsent: { granted: true },
        issueCandidate: {
          value: "furnace not working",
          sourceEventId: "evt-1",
          createdAt: new Date().toISOString(),
        },
        urgency: "EMERGENCY",
        urgencyConfirmed: true,
        voiceUrgencyConfirmation: {
          askedAt: new Date().toISOString(),
          response: "YES",
          sourceEventId: "evt-1",
        },
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-2");
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "reply",
      reply: "Thanks — I’ll text you to confirm details and secure the appointment.",
      outcome: "sms_handoff",
    });
    const nameState = {
      candidate: {
        value: "Ben Banks",
        sourceEventId: "evt-1",
        createdAt: new Date().toISOString(),
      },
      confirmed: { value: null, sourceEventId: null, confirmedAt: null },
      status: "CANDIDATE",
      locked: true,
      attemptCount: 0,
    };
    const addressState = {
      candidate: "20991 Recher Ave Euclid Ohio 44119",
      confirmed: null,
      status: "CANDIDATE",
      locked: true,
      attemptCount: 0,
      confidence: 0.9,
      sourceEventId: "evt-2",
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
      .useValue({ resolveTenantByPhone, getTenantFeePolicy })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone, getTenantFeePolicy })
      .overrideProvider(ConversationsService)
      .useValue(
        buildConversationsService({
          getVoiceConversationByCallSid,
          updateVoiceTranscript,
          getVoiceNameState: jest.fn().mockReturnValue(nameState),
          getVoiceAddressState: jest.fn().mockReturnValue(addressState),
          getVoiceSmsPhoneState: jest
            .fn()
            .mockReturnValue(buildSmsPhoneState("+12167448929", true)),
          incrementVoiceTurn,
        }),
      )
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "My furnace is not working.",
      })
      .expect(200);

    expect(response.text).toContain("service fee is $89");
    expect(response.text).toContain(
      "credited toward repairs if you approve within 24 hours",
    );
    expect(response.text).toContain("additional $150 emergency fee");
    expect(response.text).toContain("emergency fee is not credited");
    expect(response.text).toContain("approve the fees so we can move forward");

    await app.close();
  });

  it("uses ANI by default at sms handoff and closes without re-asking number", async () => {
    process.env.NODE_ENV = "development";
    process.env.VOICE_ENABLED = "true";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReturnValue(true);

    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      name: "Leizurely HVAC",
      voiceNumber: "+12167448929",
    });
    const getVoiceConversationByCallSid = jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: {
        voiceConsent: { granted: true },
        issueCandidate: {
          value: "furnace not working",
          sourceEventId: "evt-1",
          createdAt: new Date().toISOString(),
        },
        callerPhone: "+12167448929",
      },
    });
    const updateVoiceTranscript = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
    const createVoiceTranscriptLog = jest.fn().mockResolvedValue("evt-2");
    const updateVoiceSmsPhoneState = jest.fn();
    const clearVoiceSmsHandoff = jest.fn();
    const incrementVoiceTurn = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1", collectedData: {} },
      voiceTurnCount: 1,
      voiceStartedAt: new Date().toISOString(),
    });
    const aiService = buildAiService();
    aiService.triage.mockResolvedValue({
      status: "reply",
      reply: "Thanks — I'll text you to confirm details and secure the appointment.",
      outcome: "sms_handoff",
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
      .useValue(
        buildConversationsService({
          getVoiceConversationByCallSid,
          updateVoiceTranscript,
          getVoiceNameState: jest.fn().mockReturnValue(buildConfirmedNameState()),
          getVoiceAddressState: jest.fn().mockReturnValue(buildConfirmedAddressState()),
          getVoiceSmsPhoneState: jest
            .fn()
            .mockReturnValue(buildSmsPhoneState("+12167448929", false)),
          updateVoiceSmsPhoneState,
          clearVoiceSmsHandoff,
          incrementVoiceTurn,
          getConversationById: jest.fn().mockResolvedValue({
            id: "conversation-1",
            collectedData: {
              callerPhone: "+12167448929",
            },
          }),
        }),
      )
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "My furnace is not working.",
      })
      .expect(200);

    expect(updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        phoneState: expect.objectContaining({
          value: "+12167448929",
          source: "twilio_ani",
          confirmed: true,
        }),
      }),
    );
    expect(clearVoiceSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
      }),
    );
    expect(response.text).toContain("<Hangup/>");
    expect(response.text).not.toContain("best number to text updates");
    expect(response.text).toContain("service fee");
    expect(response.text).toContain("texting you now");

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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Dean Banks",
      })
      .expect(200);

    expect(updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          status: "CANDIDATE",
          locked: true,
        }),
      }),
    );
    expect(aiService.extractNameCandidate).not.toHaveBeenCalled();
    expect(response.text).toContain("Thanks, Dean.");
    expect(response.text).toContain("Please say the service address.");

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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "123 Main St",
      })
      .expect(200);

    expect(updateVoiceAddressState).not.toHaveBeenCalled();
    expect(response.text).toContain("Please say the service address.");

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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Dean Banks",
      })
      .expect(200);

    expect(response.text).toContain('bargeIn="true"');
    expect(response.text).toContain("Thanks, Dean.");
    expect(response.text).toContain("Please say the service address.");

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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "Dean Banks",
      })
      .expect(200);

    expect(updateVoiceNameState).not.toHaveBeenCalled();
    expect(response.text).toContain("What&apos;s your full name?");

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

    const app = await createTestApp(moduleRef);

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

  it("normalizes 'no, eat' into no-heat issue context once caller identity and address are confirmed", async () => {
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
    const updateVoiceIssueCandidate = jest.fn().mockResolvedValue({
      id: "conversation-1",
    });
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
        updateVoiceIssueCandidate,
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

    const app = await createTestApp(moduleRef);

    const response = await request(app.getHttpServer())
      .post("/api/voice/turn")
      .send({
        To: "+12167448929",
        CallSid: "CA123",
        SpeechResult: "no, eat",
      })
      .expect(200);

    expect(updateVoiceIssueCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        issue: expect.objectContaining({
          value: "no heat",
        }),
      }),
    );
    expect(aiService.triage).toHaveBeenCalledWith(
      "tenant-1",
      "CA123",
      "no heat",
      expect.objectContaining({
        conversationId: "conversation-1",
      }),
    );
    expect(response.text).not.toContain("main issue, like no heat or leaking water");

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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

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

    const app = await createTestApp(moduleRef);

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
      VoiceTurnService.name,
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

    const app = await createTestApp(moduleRef);

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
