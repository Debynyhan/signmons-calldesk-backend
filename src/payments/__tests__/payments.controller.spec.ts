import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PaymentsController } from "../payments.controller";
import { PaymentsService } from "../payments.service";
import { PaymentsPageRendererService } from "../payments-page-renderer.service";

describe("PaymentsController", () => {
  let app: INestApplication;
  const paymentsService = {
    getIntakePageData: jest.fn(),
    createCheckoutSessionFromIntake: jest.fn(),
    handleStripeWebhook: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        PaymentsPageRendererService,
        {
          provide: PaymentsService,
          useValue: paymentsService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("renders intake page via presentation renderer", async () => {
    paymentsService.getIntakePageData.mockResolvedValue({
      displayName: `Acme "HVAC"`,
      totalCents: 12500,
      emergency: false,
      fullName: "Dean <Banks>",
      address: "123 Main St",
      issue: "No cool air",
      phone: "+12025550100",
    });

    const response = await request(app.getHttpServer())
      .get("/api/payments/intake/tok_123")
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("Acme &quot;HVAC&quot;");
    expect(response.text).toContain("Dean &lt;Banks&gt;");
    expect(response.text).toContain(
      'action="/api/payments/intake/tok_123/checkout"',
    );
    expect(paymentsService.getIntakePageData).toHaveBeenCalledWith("tok_123");
  });

  it("redirects to Stripe checkout URL for intake checkout", async () => {
    paymentsService.createCheckoutSessionFromIntake.mockResolvedValue({
      checkoutUrl: "https://checkout.stripe.com/pay/cs_test_123",
      expiresAt: new Date().toISOString(),
    });

    const response = await request(app.getHttpServer())
      .post("/api/payments/intake/tok_123/checkout")
      .send({
        fullName: "Dean Banks",
        address: "123 Main St",
        issue: "No heat",
        phone: "+12025550100",
      })
      .expect(303);

    expect(response.headers.location).toBe(
      "https://checkout.stripe.com/pay/cs_test_123",
    );
    expect(paymentsService.createCheckoutSessionFromIntake).toHaveBeenCalledWith(
      {
        token: "tok_123",
        input: {
          fullName: "Dean Banks",
          address: "123 Main St",
          issue: "No heat",
          phone: "+12025550100",
        },
      },
    );
  });

  it("renders success and cancel pages", async () => {
    const success = await request(app.getHttpServer())
      .get("/api/payments/intake/tok_123/success")
      .expect(200);
    expect(success.headers["content-type"]).toContain("text/html");
    expect(success.text).toContain("Payment received");

    const cancel = await request(app.getHttpServer())
      .get("/api/payments/intake/tok_123/cancel")
      .expect(200);
    expect(cancel.headers["content-type"]).toContain("text/html");
    expect(cancel.text).toContain("Payment not completed");
  });
});
