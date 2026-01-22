import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import request from "supertest";
import appConfig from "../../config/app.config";
import { envValidationSchema } from "../../config/env.validation";
import { SmsModule } from "../sms.module";
import { ConversationsService } from "../../conversations/conversations.service";

describe("SmsController", () => {
  beforeEach(() => {
    process.env.ADMIN_API_TOKEN = "test-admin-token";
    process.env.NODE_ENV = "test";
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
        SmsModule,
      ],
    })
      .overrideProvider(ConversationsService)
      .useValue({
        getConversationById,
        promoteNameFromSms,
        promoteAddressFromSms,
      })
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
        SmsModule,
      ],
    })
      .overrideProvider(ConversationsService)
      .useValue({
        getConversationById,
        promoteNameFromSms,
        promoteAddressFromSms,
      })
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
        SmsModule,
      ],
    })
      .overrideProvider(ConversationsService)
      .useValue({
        getConversationById,
        promoteNameFromSms,
        promoteAddressFromSms,
      })
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
});
