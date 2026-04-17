import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import request from "supertest";
import appConfig from "../../config/app.config";
import { envValidationSchema } from "../../config/env.validation";
import { SmsModule } from "../sms.module";
import { ConversationLifecycleService } from "../../conversations/conversation-lifecycle.service";
import { ConversationsService } from "../../conversations/conversations.service";
import { VoiceConversationStateService } from "../../conversations/voice-conversation-state.service";
import { TENANTS_SERVICE } from "../../tenants/tenants.constants";
import { AI_SERVICE } from "../../ai/ai.service.interface";
import { SmsService } from "../sms.service";
import { ToolRegistryModule } from "../../ai/tools/tool-registry.module";

const validateRequestMock = jest.fn();

jest.mock("twilio", () => ({
  validateRequest: (...args: unknown[]) => validateRequestMock(...args),
}));

describe("SmsController", () => {
  beforeEach(() => {
    process.env.ADMIN_API_TOKEN = "test-admin-token";
    process.env.NODE_ENV = "test";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.TWILIO_SIGNATURE_CHECK = "false";
    process.env.TWILIO_SIGNATURE_ALLOW_INSECURE_LOCAL = "false";
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://example.ngrok.io";
    validateRequestMock.mockReset();
  });

  const buildInboundHarness = async () => {
    const getConversationById = jest.fn();
    const promoteNameFromSms = jest.fn();
    const promoteAddressFromSms = jest.fn();
    const findConversationTenantBySmsSid = jest.fn().mockResolvedValue(null);
    const ensureSmsConversation = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1" },
      sessionId: "session-1",
    });
    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      name: "leizurely_hvac",
    });
    const getActiveTenantSubscription = jest.fn().mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 60_000),
    });
    const triage = jest.fn().mockResolvedValue({
      status: "reply",
      reply: "Thanks for texting.",
    });
    const sendMessage = jest.fn().mockResolvedValue("SM123");

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          load: [appConfig],
          validationSchema: envValidationSchema,
          ignoreEnvFile: true,
        }),
        ToolRegistryModule,
        SmsModule,
      ],
    })
      .overrideProvider(ConversationsService)
      .useValue({
        getConversationById,
        findConversationTenantBySmsSid,
      })
      .overrideProvider(VoiceConversationStateService)
      .useValue({ promoteNameFromSms, promoteAddressFromSms })
      .overrideProvider(ConversationLifecycleService)
      .useValue({
        ensureSmsConversation,
      })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone, getActiveTenantSubscription })
      .overrideProvider(AI_SERVICE)
      .useValue({ triage })
      .overrideProvider(SmsService)
      .useValue({ sendMessage })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    return {
      app,
      httpServer,
      resolveTenantByPhone,
      findConversationTenantBySmsSid,
      ensureSmsConversation,
      triage,
      sendMessage,
    };
  };

  it("confirms name via SMS", async () => {
    const promoteNameFromSms = jest.fn();
    const promoteAddressFromSms = jest.fn();
    const getConversationById = jest.fn().mockResolvedValue({
      id: "conversation-1",
      tenantId: "tenant-1",
    });
    const ensureSmsConversation = jest.fn();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          load: [appConfig],
          validationSchema: envValidationSchema,
          ignoreEnvFile: true,
        }),
        ToolRegistryModule,
        SmsModule,
      ],
    })
      .overrideProvider(ConversationsService)
      .useValue({ getConversationById })
      .overrideProvider(VoiceConversationStateService)
      .useValue({ promoteNameFromSms, promoteAddressFromSms })
      .overrideProvider(ConversationLifecycleService)
      .useValue({ ensureSmsConversation })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({
        resolveTenantByPhone: jest.fn(),
        getActiveTenantSubscription: jest.fn(),
      })
      .overrideProvider(AI_SERVICE)
      .useValue({ triage: jest.fn() })
      .overrideProvider(SmsService)
      .useValue({ sendMessage: jest.fn() })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    const response = await request(httpServer)
      .post("/api/sms/confirm-field")
      .set("x-admin-token", "test-admin-token")
      .send({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        field: "name",
        value: "Dean Banks",
        sourceEventId: "sms-1",
      })
      .expect(200);

    expect(promoteNameFromSms).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        value: "Dean Banks",
        sourceEventId: "sms-1",
      }),
    );
    expect(promoteAddressFromSms).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      status: "confirmed",
      field: "name",
      conversationId: "conversation-1",
    });

    await app.close();
  });

  it("confirms address via SMS", async () => {
    const promoteNameFromSms = jest.fn();
    const promoteAddressFromSms = jest.fn();
    const getConversationById = jest.fn().mockResolvedValue({
      id: "conversation-1",
      tenantId: "tenant-1",
    });
    const ensureSmsConversation = jest.fn();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          load: [appConfig],
          validationSchema: envValidationSchema,
          ignoreEnvFile: true,
        }),
        ToolRegistryModule,
        SmsModule,
      ],
    })
      .overrideProvider(ConversationsService)
      .useValue({ getConversationById })
      .overrideProvider(VoiceConversationStateService)
      .useValue({ promoteNameFromSms, promoteAddressFromSms })
      .overrideProvider(ConversationLifecycleService)
      .useValue({ ensureSmsConversation })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({
        resolveTenantByPhone: jest.fn(),
        getActiveTenantSubscription: jest.fn(),
      })
      .overrideProvider(AI_SERVICE)
      .useValue({ triage: jest.fn() })
      .overrideProvider(SmsService)
      .useValue({ sendMessage: jest.fn() })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    const response = await request(httpServer)
      .post("/api/sms/confirm-field")
      .set("x-admin-token", "test-admin-token")
      .send({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        field: "address",
        value: "20991 Recher Ave",
        sourceEventId: "sms-2",
      })
      .expect(200);

    expect(promoteAddressFromSms).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        value: "20991 Recher Ave",
        sourceEventId: "sms-2",
      }),
    );
    expect(promoteNameFromSms).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      status: "confirmed",
      field: "address",
      conversationId: "conversation-1",
    });

    await app.close();
  });

  it("fails closed when conversation is not found", async () => {
    const promoteNameFromSms = jest.fn();
    const promoteAddressFromSms = jest.fn();
    const getConversationById = jest.fn().mockResolvedValue(null);
    const ensureSmsConversation = jest.fn();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          load: [appConfig],
          validationSchema: envValidationSchema,
          ignoreEnvFile: true,
        }),
        ToolRegistryModule,
        SmsModule,
      ],
    })
      .overrideProvider(ConversationsService)
      .useValue({ getConversationById })
      .overrideProvider(VoiceConversationStateService)
      .useValue({ promoteNameFromSms, promoteAddressFromSms })
      .overrideProvider(ConversationLifecycleService)
      .useValue({ ensureSmsConversation })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({
        resolveTenantByPhone: jest.fn(),
        getActiveTenantSubscription: jest.fn(),
      })
      .overrideProvider(AI_SERVICE)
      .useValue({ triage: jest.fn() })
      .overrideProvider(SmsService)
      .useValue({ sendMessage: jest.fn() })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .post("/api/sms/confirm-field")
      .set("x-admin-token", "test-admin-token")
      .send({
        tenantId: "tenant-1",
        conversationId: "conversation-missing",
        field: "name",
        value: "Dean Banks",
      })
      .expect(404);

    expect(promoteNameFromSms).not.toHaveBeenCalled();
    expect(promoteAddressFromSms).not.toHaveBeenCalled();

    await app.close();
  });

  it("routes inbound SMS through AI and replies", async () => {
    process.env.TWILIO_SIGNATURE_CHECK = "true";
    validateRequestMock.mockReturnValue(true);
    const {
      app,
      httpServer,
      resolveTenantByPhone,
      ensureSmsConversation,
      triage,
      sendMessage,
    } = await buildInboundHarness();

    await request(httpServer)
      .post("/api/sms/inbound")
      .set("x-twilio-signature", "good-sig")
      .send({
        From: "+12025550100",
        To: "+12025550199",
        Body: "Hello",
        SmsSid: "SM123",
      })
      .expect(204);

    expect(resolveTenantByPhone).toHaveBeenCalledWith("+12025550199");
    expect(ensureSmsConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        fromNumber: "+12025550100",
        smsSid: "SM123",
      }),
    );
    expect(triage).toHaveBeenCalledWith(
      "tenant-1",
      "session-1",
      "Hello",
      expect.objectContaining({
        conversationId: "conversation-1",
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+12025550100",
        from: "+12025550199",
        body: "Thanks for texting.",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
      }),
    );
    expect(validateRequestMock).toHaveBeenCalledWith(
      expect.any(String),
      "good-sig",
      "https://example.ngrok.io/api/sms/inbound",
      expect.objectContaining({ SmsSid: "SM123" }),
    );

    await app.close();
  });

  it("fails closed when inbound SmsSid belongs to a different tenant", async () => {
    process.env.TWILIO_SIGNATURE_CHECK = "true";
    validateRequestMock.mockReturnValue(true);
    const {
      app,
      httpServer,
      findConversationTenantBySmsSid,
      ensureSmsConversation,
      triage,
      sendMessage,
    } = await buildInboundHarness();
    findConversationTenantBySmsSid.mockResolvedValue({
      id: "conversation-foreign",
      tenantId: "tenant-foreign",
    });

    await request(httpServer)
      .post("/api/sms/inbound")
      .set("x-twilio-signature", "good-sig")
      .send({
        From: "+12025550100",
        To: "+12025550199",
        Body: "Hello",
        SmsSid: "SM123",
      })
      .expect(204);

    expect(ensureSmsConversation).not.toHaveBeenCalled();
    expect(triage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects inbound SMS when Twilio signature is missing", async () => {
    process.env.TWILIO_SIGNATURE_CHECK = "true";
    const { app, httpServer, ensureSmsConversation, sendMessage, triage } =
      await buildInboundHarness();

    await request(httpServer)
      .post("/api/sms/inbound")
      .send({
        From: "+12025550100",
        To: "+12025550199",
        Body: "Hello",
        SmsSid: "SM123",
      })
      .expect(401);

    expect(validateRequestMock).not.toHaveBeenCalled();
    expect(ensureSmsConversation).not.toHaveBeenCalled();
    expect(triage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects inbound SMS when Twilio signature is invalid", async () => {
    process.env.TWILIO_SIGNATURE_CHECK = "true";
    validateRequestMock.mockReturnValue(false);
    const { app, httpServer, ensureSmsConversation, sendMessage, triage } =
      await buildInboundHarness();

    await request(httpServer)
      .post("/api/sms/inbound")
      .set("x-twilio-signature", "bad-sig")
      .send({
        From: "+12025550100",
        To: "+12025550199",
        Body: "Hello",
        SmsSid: "SM123",
      })
      .expect(401);

    expect(validateRequestMock).toHaveBeenCalled();
    expect(ensureSmsConversation).not.toHaveBeenCalled();
    expect(triage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();

    await app.close();
  });

  it("allows explicit local bypass in development for inbound SMS", async () => {
    process.env.NODE_ENV = "development";
    process.env.TWILIO_SIGNATURE_CHECK = "true";
    process.env.TWILIO_SIGNATURE_ALLOW_INSECURE_LOCAL = "true";
    const { app, httpServer, ensureSmsConversation, sendMessage } =
      await buildInboundHarness();

    await request(httpServer)
      .post("/api/sms/inbound")
      .send({
        From: "+12025550100",
        To: "+12025550199",
        Body: "Hello",
        SmsSid: "SM123",
      })
      .expect(204);

    expect(validateRequestMock).not.toHaveBeenCalled();
    expect(ensureSmsConversation).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();

    await app.close();
  });
});
