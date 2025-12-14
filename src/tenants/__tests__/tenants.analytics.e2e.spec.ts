import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../app.module";
import { PrismaService } from "../../prisma/prisma.service";

const canRunE2E = Boolean(process.env.TEST_DATABASE_URL);
const describeOrSkip = canRunE2E ? describe : describe.skip;

describeOrSkip("Tenant analytics API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    }
    process.env.ADMIN_API_TOKEN =
      process.env.ADMIN_API_TOKEN ?? "test-admin-token";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.callLog.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.tenantAnalytics.deleteMany({});
    await prisma.tenant.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns analytics snapshot for a tenant", async () => {
    const adminToken = process.env.ADMIN_API_TOKEN ?? "test-admin-token";
    const server: Parameters<typeof request>[0] = app.getHttpServer();

    const tenantResponse = await request(server)
      .post("/tenants")
      .set("x-admin-token", adminToken)
      .send({
        name: "analytics_demo",
        displayName: "Analytics Demo",
        instructions: "Collect everything.",
      })
      .expect(201);

    const tenantId = (tenantResponse.body as { tenantId: string }).tenantId;

    await prisma.tenantAnalytics.create({
      data: {
        tenantId,
        callCount: 5,
        jobsCreated: 2,
        toolUsage: { create_job: 2 },
        totalInfoCollectionMs: BigInt(6000),
        completedSessions: 3,
      },
    });

    const analyticsResponse = await request(server)
      .get(`/tenants/${tenantId}/analytics`)
      .set("x-admin-token", adminToken)
      .expect(200);

    expect(analyticsResponse.body).toEqual({
      callCount: 5,
      jobsCreated: 2,
      toolUsage: { create_job: 2 },
      averageInfoCollectionMs: 2000,
    });
  });
});
