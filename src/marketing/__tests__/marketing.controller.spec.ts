import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import request from "supertest";
import appConfig from "../../config/app.config";
import { envValidationSchema } from "../../config/env.validation";
import { MarketingModule } from "../marketing.module";
import { MarketingService } from "../marketing.service";

describe("MarketingController", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.OPENAI_API_KEY = "test-key-1234567890";
  });

  it("accepts try-demo submissions and returns call metadata", async () => {
    const submitTryDemo = jest.fn().mockResolvedValue({
      status: "queued",
      leadId: "lead-1",
      call: {
        status: "initiated",
        to: "+12165551234",
        from: "+12167448929",
        callSid: "CA123",
      },
      estimatedWaitSec: 20,
      retry: { allowed: false, afterSec: 0, reason: null },
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
        MarketingModule,
      ],
    })
      .overrideProvider(MarketingService)
      .useValue({ submitTryDemo })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const payload = {
      phone: "+12165551234",
      consentToAutoCall: true,
      consentTextVersion: "try-demo-v1",
      name: "Ben Banks",
      company: "Leizurely HVAC",
      email: "ben@leizurely.com",
      demoScenario: "hvac",
      timezone: "America/New_York",
      preferredCallTime: null,
      utm: { source: "google", medium: "cpc", campaign: "try-demo" },
      referrerUrl: "https://signmons.com/try-demo",
    };

    const response = await request(app.getHttpServer())
      .post("/api/marketing/try-demo")
      .send(payload)
      .expect(202);

    expect(submitTryDemo).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+12165551234",
        consentToAutoCall: true,
        consentTextVersion: "try-demo-v1",
      }),
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        status: "queued",
        leadId: "lead-1",
        call: expect.objectContaining({
          status: "initiated",
          to: "+12165551234",
        }),
      }),
    );

    await app.close();
  });

  it("accepts try-demo status callbacks", async () => {
    const handleTryDemoStatusCallback = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          load: [appConfig],
          validationSchema: envValidationSchema,
          ignoreEnvFile: true,
        }),
        MarketingModule,
      ],
    })
      .overrideProvider(MarketingService)
      .useValue({ handleTryDemoStatusCallback })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post("/api/marketing/try-demo/status?leadId=lead-1")
      .send({ CallSid: "CA123", CallStatus: "busy" })
      .expect(204);

    expect(handleTryDemoStatusCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        CallSid: "CA123",
        CallStatus: "busy",
      }),
      "lead-1",
    );

    await app.close();
  });

  it("returns try-demo status for polling", async () => {
    const getTryDemoStatus = jest.fn().mockResolvedValue({
      leadId: "lead-1",
      status: "FAILED",
      call: { status: "failed", callSid: "CA123" },
      failureReason: "busy",
      retry: { allowed: false, afterSec: 120, reason: "rate_limited" },
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
        MarketingModule,
      ],
    })
      .overrideProvider(MarketingService)
      .useValue({ getTryDemoStatus })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/api/marketing/try-demo/lead-1")
      .expect(200);

    expect(getTryDemoStatus).toHaveBeenCalledWith("lead-1");
    expect(response.body).toEqual(
      expect.objectContaining({
        leadId: "lead-1",
        status: "FAILED",
        call: expect.objectContaining({ status: "failed", callSid: "CA123" }),
        failureReason: "busy",
        retry: expect.objectContaining({ allowed: false, reason: "rate_limited" }),
      }),
    );

    await app.close();
  });
});
