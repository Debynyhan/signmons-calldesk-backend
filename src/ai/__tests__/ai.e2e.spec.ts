import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type OpenAI from "openai";
import { AppModule } from "../../app.module";
import { PrismaService } from "../../prisma/prisma.service";
import { AI_PROVIDER } from "../ai.constants";
import type { IAiProvider } from "../interfaces/ai-provider.interface";
import { requestContextMiddleware } from "../../common/context/request-context";

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
const devAuthSecret = process.env.DEV_AUTH_SECRET ?? "dev-auth-secret";

const devHeaders = (tenantId: string) => ({
  "Content-Type": "application/json",
  "x-dev-auth": devAuthSecret,
  "x-dev-user-id": "dev-admin",
  "x-dev-role": "admin",
  "x-dev-tenant-id": tenantId,
});

describeOrSkip("AI create-job flow (e2e)", () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let prisma: {
    communicationContent: {
      deleteMany: (args?: unknown) => Promise<unknown>;
      findMany: (args?: unknown) => Promise<Array<{ payload: unknown }>>;
    };
    communicationEvent: { deleteMany: (args?: unknown) => Promise<unknown> };
    conversation: {
      deleteMany: (args?: unknown) => Promise<unknown>;
      findFirst: (args?: unknown) => Promise<{ currentFSMState?: string } | null>;
    };
    conversationJobLink: {
      deleteMany: (args?: unknown) => Promise<unknown>;
      findMany: (args?: unknown) => Promise<Array<{ jobId: string }>>;
    };
    job: { deleteMany: (args?: unknown) => Promise<unknown>; findMany: (args?: unknown) => Promise<Array<{ id: string }>> };
    propertyAddress: { deleteMany: (args?: unknown) => Promise<unknown> };
    customer: { deleteMany: (args?: unknown) => Promise<unknown> };
    serviceCategory: { deleteMany: (args?: unknown) => Promise<unknown> };
    tenantOrganization: { deleteMany: (args?: unknown) => Promise<unknown> };
  };

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    }
    process.env.ADMIN_API_TOKEN =
      process.env.ADMIN_API_TOKEN ?? "test-admin-token";
    process.env.DEV_AUTH_ENABLED = "true";
    process.env.DEV_AUTH_SECRET = process.env.DEV_AUTH_SECRET ?? "dev-auth-secret";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_PROVIDER)
      .useValue(new FakeAiProvider())
      .compile();

    app = moduleRef.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();

    prismaService = app.get(PrismaService);
    prisma = prismaService as unknown as typeof prisma;
  });

  afterEach(async () => {
    await prisma.communicationContent.deleteMany({});
    await prisma.communicationEvent.deleteMany({});
    await prisma.conversationJobLink.deleteMany({});
    await prisma.conversation.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.propertyAddress.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.serviceCategory.deleteMany({});
    await prisma.tenantOrganization.deleteMany({});
  });

  afterAll(async () => {
    await prismaService.$disconnect();
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
        displayName: "Demo HVAC Contractor",
        instructions: "Gather info and book emergencies immediately.",
      })
      .expect(201);

    const tenantPayload = tenantResponse.body as { tenantId: string };
    const tenantId = tenantPayload.tenantId;
    expect(tenantId).toBeDefined();

    const triageResponse = await request(server)
      .post("/ai/triage")
      .set(devHeaders(tenantId))
      .send({
        sessionId: "session-abc",
        message: "Caller reports no heat and wants immediate help.",
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

    const logs = await prisma.communicationContent.findMany({
      where: { tenantId },
    });
    const hasJobLog = logs.some((log) => {
      if (!log.payload || typeof log.payload !== "object") {
        return false;
      }
      return (log.payload as Record<string, unknown>).jobId === jobs[0].id;
    });
    expect(hasJobLog).toBe(true);

    const conversation = await prisma.conversation.findFirst({
      where: {
        tenantId,
        collectedData: {
          path: ["sessionId"],
          equals: "session-abc",
        },
      },
    });
    expect(conversation).toBeTruthy();
    expect(conversation?.currentFSMState).toBe("TRIAGE");

    const links = await prisma.conversationJobLink.findMany({
      where: {
        tenantId,
        conversationId: conversation?.id,
        jobId: jobs[0].id,
      },
    });
    expect(links).toHaveLength(1);
  });

  it("isolates tenants across AI triage logs and jobs", async () => {
    const adminToken = process.env.ADMIN_API_TOKEN ?? "test-admin-token";
    const server: Parameters<typeof request>[0] = app.getHttpServer();

    const tenantAResponse = await request(server)
      .post("/tenants")
      .set("x-admin-token", adminToken)
      .send({
        name: "tenant_a",
        displayName: "Tenant A",
        instructions: "Handle calls for tenant A.",
      })
      .expect(201);

    const tenantBResponse = await request(server)
      .post("/tenants")
      .set("x-admin-token", adminToken)
      .send({
        name: "tenant_b",
        displayName: "Tenant B",
        instructions: "Handle calls for tenant B.",
      })
      .expect(201);

    const tenantAId = (tenantAResponse.body as { tenantId: string }).tenantId;
    const tenantBId = (tenantBResponse.body as { tenantId: string }).tenantId;

    await request(server)
      .post("/ai/triage")
      .set(devHeaders(tenantAId))
      .send({
        sessionId: "session-a",
        message: "Tenant A needs help with heating.",
      })
      .expect(201);

    await request(server)
      .post("/ai/triage")
      .set(devHeaders(tenantBId))
      .send({
        sessionId: "session-b",
        message: "Tenant B needs help with cooling.",
      })
      .expect(201);

    const tenantAJobs = await prisma.job.findMany({
      where: { tenantId: tenantAId },
    });
    const tenantBJobs = await prisma.job.findMany({
      where: { tenantId: tenantBId },
    });

    expect(tenantAJobs).toHaveLength(1);
    expect(tenantBJobs).toHaveLength(1);
    expect(tenantAJobs[0].tenantId).toBe(tenantAId);
    expect(tenantBJobs[0].tenantId).toBe(tenantBId);

    const tenantALogs = await prisma.communicationContent.findMany({
      where: { tenantId: tenantAId },
    });
    const tenantBLogs = await prisma.communicationContent.findMany({
      where: { tenantId: tenantBId },
    });

    const tenantAJobId = tenantAJobs[0]?.id;
    const tenantBJobId = tenantBJobs[0]?.id;

    const hasForeignJobId = (
      logs: Array<{ payload: unknown }>,
      forbiddenJobId: string,
    ) =>
      logs.some((log) => {
        if (!log.payload || typeof log.payload !== "object") {
          return false;
        }
        const jobId = (log.payload as Record<string, unknown>).jobId;
        return typeof jobId === "string" && jobId === forbiddenJobId;
      });

    expect(tenantALogs.length).toBeGreaterThan(0);
    expect(tenantBLogs.length).toBeGreaterThan(0);
    expect(hasForeignJobId(tenantALogs, tenantBJobId)).toBe(false);
    expect(hasForeignJobId(tenantBLogs, tenantAJobId)).toBe(false);

    const tenantAConversation = await prisma.conversation.findFirst({
      where: {
        tenantId: tenantAId,
        collectedData: {
          path: ["sessionId"],
          equals: "session-a",
        },
      },
    });
    const tenantBConversation = await prisma.conversation.findFirst({
      where: {
        tenantId: tenantBId,
        collectedData: {
          path: ["sessionId"],
          equals: "session-b",
        },
      },
    });
    expect(tenantAConversation).toBeTruthy();
    expect(tenantBConversation).toBeTruthy();

    const tenantALinks = await prisma.conversationJobLink.findMany({
      where: {
        tenantId: tenantAId,
        conversationId: tenantAConversation?.id,
      },
    });
    const tenantBLinks = await prisma.conversationJobLink.findMany({
      where: {
        tenantId: tenantBId,
        conversationId: tenantBConversation?.id,
      },
    });
    expect(tenantALinks).toHaveLength(1);
    expect(tenantBLinks).toHaveLength(1);
  });
});
