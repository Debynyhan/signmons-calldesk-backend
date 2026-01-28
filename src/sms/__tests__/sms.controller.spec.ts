import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import request from "supertest";
import appConfig from "../../config/app.config";
import { envValidationSchema } from "../../config/env.validation";
import { SmsModule } from "../sms.module";
import { ConversationsService } from "../../conversations/conversations.service";
import { TENANTS_SERVICE } from "../../tenants/tenants.constants";
import { AiService } from "../../ai/ai.service";
import { SmsService } from "../sms.service";
import { ToolRegistryModule } from "../../ai/tools/tool-registry.module";

describe("SmsController", () => {
  beforeEach(() => {
    process.env.ADMIN_API_TOKEN = "test-admin-token";
    process.env.NODE_ENV = "test";
    process.env.OPENAI_API_KEY = "test-openai-key";
  });

  it("confirms name via SMS", async () => {
    const promoteNameFromSms = jest.fn();
    const promoteAddressFromSms = jest.fn();
    const getConversationById = jest.fn().mockResolvedValue({
      id: "conversation-1",
      tenantId: "tenant-1",
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
        ToolRegistryModule,
        SmsModule,
      ],
    })
      .overrideProvider(ConversationsService)
      .useValue({
        getConversationById,
        promoteNameFromSms,
        promoteAddressFromSms,
      })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone: jest.fn() })
      .overrideProvider(AiService)
      .useValue({ triage: jest.fn() })
      .overrideProvider(SmsService)
      .useValue({ sendMessage: jest.fn() })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
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
        promoteNameFromSms,
        promoteAddressFromSms,
      })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone: jest.fn() })
      .overrideProvider(AiService)
      .useValue({ triage: jest.fn() })
      .overrideProvider(SmsService)
      .useValue({ sendMessage: jest.fn() })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
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
        promoteNameFromSms,
        promoteAddressFromSms,
      })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone: jest.fn() })
      .overrideProvider(AiService)
      .useValue({ triage: jest.fn() })
      .overrideProvider(SmsService)
      .useValue({ sendMessage: jest.fn() })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
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
    const getConversationById = jest.fn();
    const promoteNameFromSms = jest.fn();
    const promoteAddressFromSms = jest.fn();
    const getConversationBySmsSid = jest.fn().mockResolvedValue(null);
    const ensureSmsConversation = jest.fn().mockResolvedValue({
      conversation: { id: "conversation-1" },
      sessionId: "session-1",
    });
    const resolveTenantByPhone = jest.fn().mockResolvedValue({
      id: "tenant-1",
      name: "leizurely_hvac",
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
        promoteNameFromSms,
        promoteAddressFromSms,
        getConversationBySmsSid,
        ensureSmsConversation,
      })
      .overrideProvider(TENANTS_SERVICE)
      .useValue({ resolveTenantByPhone })
      .overrideProvider(AiService)
      .useValue({ triage })
      .overrideProvider(SmsService)
      .useValue({ sendMessage })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post("/api/sms/inbound")
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

    await app.close();
  });
});
