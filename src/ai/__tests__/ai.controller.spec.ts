import { jest } from "@jest/globals";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AiController } from "../ai.controller";
import { AiService } from "../ai.service";

describe("AiController integration", () => {
  let app: INestApplication;
  const aiService = {
    triage: jest.fn(),
  } as unknown as jest.Mocked<AiService>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AiController],
      providers: [{ provide: AiService, useValue: aiService }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => {
    aiService.triage.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns job_created tool events over HTTP", async () => {
    const jobPayload = {
      id: "job-123",
      tenantId: "tenant-1",
      customerName: "Alice",
      phone: "555-000-1111",
      issueCategory: "HEATING",
      urgency: "EMERGENCY",
      status: "PENDING" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const jobResponse = {
      ...jobPayload,
      createdAt: jobPayload.createdAt.toISOString(),
      updatedAt: jobPayload.updatedAt.toISOString(),
    };
    aiService.triage.mockResolvedValue({
      status: "job_created",
      job: jobPayload,
      message: "Job created successfully.",
    });

    const response = await request(app.getHttpServer())
      .post("/ai/triage")
      .send({
        tenantId: "tenant-1",
        sessionId: "session-1",
        message: "Please help.",
      })
      .expect(201);

    expect(response.body).toEqual({
      status: "job_created",
      job: jobResponse,
      message: "Job created successfully.",
    });
    expect(aiService.triage).toHaveBeenCalledWith(
      "tenant-1",
      "session-1",
      "Please help.",
    );
  });

  it("surfaces unsupported tool events without modification", async () => {
    aiService.triage.mockResolvedValue({
      status: "unsupported_tool",
      toolName: "request_more_info",
      rawArgs: JSON.stringify({ field: "value" }),
    });

    const response = await request(app.getHttpServer())
      .post("/ai/triage")
      .send({
        tenantId: "tenant-2",
        sessionId: "session-2",
        message: "Need clarification.",
      })
      .expect(201);

    expect(response.body).toEqual({
      status: "unsupported_tool",
      toolName: "request_more_info",
      rawArgs: JSON.stringify({ field: "value" }),
    });
  });

  it("returns generic tool_called events as received from the service", async () => {
    aiService.triage.mockResolvedValue({
      status: "tool_called",
      toolName: "mark_emergency",
      rawArgs: JSON.stringify({ urgency: "EMERGENCY" }),
    });

    const response = await request(app.getHttpServer())
      .post("/ai/triage")
      .send({
        tenantId: "tenant-3",
        sessionId: "session-3",
        message: "Caller says system is smoking.",
      })
      .expect(201);

    expect(response.body).toEqual({
      status: "tool_called",
      toolName: "mark_emergency",
      rawArgs: JSON.stringify({ urgency: "EMERGENCY" }),
    });
  });
});
