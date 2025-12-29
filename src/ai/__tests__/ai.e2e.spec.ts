import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type OpenAI from "openai";
import { AppModule } from "../../app.module";
import { PrismaService } from "../../prisma/prisma.service";
import { AI_PROVIDER } from "../ai.constants";
import type { IAiProvider } from "../interfaces/ai-provider.interface";

class FakeAiProvider implements IAiProvider {
  createCompletion(): Promise<OpenAI.ChatCompletion> {
    return Promise.resolve({
      id: "fake_response",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "fake-model",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          logprobs: null,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tool-call-1",
                type: "function",
                function: {
                  name: "create_job",
                  arguments: JSON.stringify({
                    customerName: "Alice Example",
                    phone: "555-111-2222",
                    address: "123 Main St",
                    issueCategory: "HEATING",
                    urgency: "EMERGENCY",
                    description: "No heat",
                    preferredTime: "ASAP",
                  }),
                },
              },
            ],
            refusal: null,
          },
        },
      ],
      usage: {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
      },
    });
  }
}

const canRunE2E =
  process.env.RUN_E2E === "true" && Boolean(process.env.TEST_DATABASE_URL);
const describeOrSkip = canRunE2E ? describe : describe.skip;

describeOrSkip("AI create-job flow (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required to run e2e tests.");
    }
    if (process.env.TEST_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    }
    process.env.ADMIN_API_TOKEN =
      process.env.ADMIN_API_TOKEN ?? "test-admin-token";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_PROVIDER)
      .useValue(new FakeAiProvider())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.communicationContent.deleteMany({});
    await prisma.communicationEvent.deleteMany({});
    await prisma.conversationJobLink.deleteMany({});
    await prisma.jobOffer.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.conversation.deleteMany({});
    await prisma.propertyAddress.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.serviceCategory.deleteMany({});
    await prisma.tenantSubscription.deleteMany({});
    await prisma.tenantOrganization.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a tenant and a job via HTTP APIs", async () => {
    const adminToken = process.env.ADMIN_API_TOKEN ?? "test-admin-token";
    const server: Parameters<typeof request>[0] = app.getHttpServer();
    const tenantResponse = await request(server)
      .post("/tenants")
      .set("x-admin-token", adminToken)
      .send({
        name: "demo_hvac",
        settings: {
          displayName: "Demo HVAC Contractor",
          instructions: "Gather info and book emergencies immediately.",
        },
      })
      .expect(201);

    const tenantPayload = tenantResponse.body as { tenantId: string };
    const tenantId = tenantPayload.tenantId;
    expect(tenantId).toBeDefined();

    const triageResponse = await request(server)
      .post("/ai/triage")
      .set("Content-Type", "application/json")
      .send({
        tenantId,
        sessionId: "session-abc",
        message: "Caller reports no heat and wants immediate help.",
        channel: "WEBCHAT",
        metadata: {
          source: "e2e",
        },
      })
      .expect(201);

    const triageBody = triageResponse.body as {
      status: string;
      job: { id: string; tenantId: string; customerName: string };
    };

    expect(triageBody.status).toBe("job_created");
    expect(triageBody.job).toMatchObject({
      tenantId,
      customerName: "Alice Example",
      issueCategory: "HEATING",
    });

    const jobs = await prisma.job.findMany({ where: { tenantId } });
    expect(jobs).toHaveLength(1);

    const events = await prisma.communicationEvent.findMany({
      where: { tenantId, jobId: jobs[0].id },
    });
    expect(events.length).toBeGreaterThan(0);
  });
});
