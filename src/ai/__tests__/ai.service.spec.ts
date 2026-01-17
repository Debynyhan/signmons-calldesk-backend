import { jest } from "@jest/globals";
import { AiService } from "../ai.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import { CallLogService } from "../../logging/call-log.service";
import type { IAiProvider } from "../interfaces/ai-provider.interface";
import type {
  IJobRepository,
  JobRecord,
} from "../../jobs/interfaces/job-repository.interface";
import { AiErrorHandler } from "../ai-error.handler";
import { LoggingService } from "../../logging/logging.service";
import type { TenantsService } from "../../tenants/interfaces/tenants-service.interface";
import { AiProviderService } from "../providers/ai-provider.service";
import type { IAiProviderClient } from "../providers/ai-provider.interface";
import appConfig from "../../config/app.config";
import { ToolSelectorService } from "../tools/tool-selector.service";
import { ConversationsService } from "../../conversations/conversations.service";

jest.mock("fs", () => ({
  readFileSync: jest.fn(() => "System prompt"),
  existsSync: jest.fn(() => true),
}));

class ToolSelectorStub {
  getEnabledToolsForTenant = jest
    .fn<(tenantId: string) => unknown[]>()
    .mockReturnValue([]);
}

describe("AiService", () => {
  const tenantId = "8cf1e75e-14e7-4d4f-afd1-b4416a832ba1";
  const sessionId = "test-session";

  let aiProvider: jest.Mocked<IAiProvider>;
  let errorHandler: jest.Mocked<AiErrorHandler>;
  let loggingService: jest.Mocked<LoggingService>;
  let sanitizationService: SanitizationService;
  let toolSelector: ToolSelectorService;
  let jobsRepository: jest.Mocked<IJobRepository>;
  let tenantsService: jest.Mocked<TenantsService>;
  let callLogService: jest.Mocked<CallLogService>;
  let conversationsService: jest.Mocked<ConversationsService>;
  let config: ReturnType<typeof appConfig>;
  let service: AiService;

  beforeEach(() => {
    aiProvider = {
      createCompletion: jest.fn(),
    } as unknown as jest.Mocked<IAiProvider>;
    errorHandler = {
      handle: jest.fn(),
    } as unknown as jest.Mocked<AiErrorHandler>;
    loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<LoggingService>;
    sanitizationService = new SanitizationService();
    toolSelector = new ToolSelectorStub() as unknown as ToolSelectorService;
    jobsRepository = {
      createJobFromToolCall: jest.fn(),
      listJobs: jest.fn(),
    } as unknown as jest.Mocked<IJobRepository>;
    tenantsService = {
      getTenantContext: jest.fn(),
      createTenant: jest.fn(),
    } as unknown as jest.Mocked<TenantsService>;
    tenantsService.getTenantContext.mockResolvedValue({
      tenantId,
      displayName: "Demo Contractor",
      instructions: "Collect caller details and determine urgency.",
      prompt: "You are acting for Demo Contractor.",
    });
    callLogService = {
      createLog: jest.fn(),
      getRecentMessages: jest.fn(),
      clearSession: jest.fn(),
    } as unknown as jest.Mocked<CallLogService>;
    callLogService.getRecentMessages.mockResolvedValue([]);
    conversationsService = {
      ensureConversation: jest.fn(),
      linkJobToConversation: jest.fn(),
    } as unknown as jest.Mocked<ConversationsService>;
    conversationsService.ensureConversation.mockResolvedValue({
      id: "conversation-1",
    } as never);
    config = {
      environment: "test",
      openAiApiKey: "test",
      enablePreviewModel: false,
      enabledTools: [],
      aiMaxTokens: 800,
      aiMaxToolCalls: 1,
      aiTimeoutMs: 15000,
      aiMaxRetries: 1,
      port: 3000,
      databaseUrl: "postgres://user:pass@localhost:5432/db",
      adminApiToken: "token",
      devAuthEnabled: true,
      devAuthSecret: "dev-auth-secret",
      identityIssuer: "http://localhost",
      identityAudience: "signmons",
      corsOrigins: ["http://localhost:3000"],
    };

    service = new AiService(
      aiProvider,
      errorHandler,
      loggingService,
      sanitizationService,
      toolSelector,
      jobsRepository,
      tenantsService,
      callLogService,
      conversationsService,
      config,
    );
  });

  it("returns AI reply and logs conversation", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-1",
      choices: [
        {
          message: { role: "assistant", content: "Hello there!" },
        },
      ],
    } as never);

    const response = await service.triage(
      tenantId,
      sessionId,
      "Hello there, I need help.",
    );

    expect(response).toEqual({ status: "reply", reply: "Hello there!" });
    expect(callLogService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        sessionId,
        conversationId: "conversation-1",
        transcript: "Hello there, I need help.",
        aiResponse: "Hello there!",
        metadata: expect.objectContaining({ openAIResponseId: "resp-1" }),
      }),
    );
  });

  it("routes create_job tool calls to the job repository", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-2",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "create_job",
                  arguments: JSON.stringify({
                    customerName: "Alice",
                    phone: "123",
                    issueCategory: "HEATING",
                    urgency: "EMERGENCY",
                  }),
                },
              },
            ],
          },
        },
      ],
    } as never);

    const jobRecord: JobRecord = {
      id: "job-1",
      tenantId,
      customerName: "Alice",
      phone: "123",
      issueCategory: "HEATING",
      urgency: "EMERGENCY",
      status: "PENDING" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    jobsRepository.createJobFromToolCall.mockResolvedValue(jobRecord);

    const response = await service.triage(tenantId, sessionId, "Create job.");

    expect(response).toEqual({
      status: "job_created",
      job: jobRecord,
      message: "Job created successfully.",
    });
    expect(jobsRepository.createJobFromToolCall).toHaveBeenCalledWith({
      tenantId,
      sessionId,
      rawArgs: expect.any(String),
    });
    expect(callLogService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        sessionId,
        jobId: jobRecord.id,
        conversationId: "conversation-1",
        metadata: expect.objectContaining({ toolName: "create_job" }),
      }),
    );
    expect(conversationsService.linkJobToConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        conversationId: "conversation-1",
        jobId: jobRecord.id,
      }),
    );
    expect(callLogService.clearSession).toHaveBeenCalledWith(
      tenantId,
      sessionId,
      "conversation-1",
    );
  });

  it("delegates provider errors to the AiErrorHandler", async () => {
    aiProvider.createCompletion.mockRejectedValue(new Error("network"));
    await service.triage(tenantId, sessionId, "Hello");
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "triage",
        tenantId,
      }),
    );
  });

  it("fails closed when AI returns an empty reply", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-3",
      choices: [
        {
          message: { role: "assistant", content: null },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "Hello");
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.invalid_output",
        tenantId,
        reason: "empty_reply",
      }),
      AiService.name,
    );
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "triage",
        tenantId,
      }),
    );
  });

  it("fails closed when tool args are invalid JSON", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-4",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-2",
                type: "function",
                function: {
                  name: "create_job",
                  arguments: "{not-json}",
                },
              },
            ],
          },
        },
      ],
    } as never);
    jobsRepository.createJobFromToolCall.mockImplementation(() => {
      throw new Error("Invalid job payload.");
    });

    await service.triage(tenantId, sessionId, "Create job.");
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "tool_call",
        tenantId,
      }),
    );
  });

  it("logs refusals when the model declines", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-5",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            refusal: "policy_violation",
          },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "Disallowed request.");

    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.refusal",
        tenantId,
        reason: "policy_violation",
      }),
      AiService.name,
    );
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "triage",
        tenantId,
      }),
    );
  });
});

describe("AiProviderService", () => {
  const mockConfig: ReturnType<typeof appConfig> = {
    environment: "test",
    openAiApiKey: "test",
    enablePreviewModel: true,
    enabledTools: [],
    aiMaxTokens: 800,
    aiMaxToolCalls: 1,
    aiTimeoutMs: 15000,
    aiMaxRetries: 1,
    port: 3000,
    databaseUrl: "postgres://user:pass@localhost:5432/db",
    adminApiToken: "token",
    devAuthEnabled: true,
    devAuthSecret: "dev-auth-secret",
    identityIssuer: "http://localhost",
    identityAudience: "signmons",
    corsOrigins: ["http://localhost:3000"],
  };

  let client: jest.Mocked<IAiProviderClient>;
  let errorHandler: jest.Mocked<AiErrorHandler>;
  let loggingService: jest.Mocked<LoggingService>;
  let provider: AiProviderService;

  beforeEach(() => {
    client = {
      createCompletion: jest.fn(),
    } as unknown as jest.Mocked<IAiProviderClient>;
    errorHandler = {
      handle: jest.fn(),
    } as unknown as jest.Mocked<AiErrorHandler>;
    errorHandler.handle.mockImplementation((error) => {
      throw (error as Error) ?? new Error("handled");
    });
    loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<LoggingService>;

    provider = new AiProviderService(
      client,
      mockConfig,
      errorHandler,
      loggingService,
    );
  });

  it("falls back to default model when preview model fails", async () => {
    const fallbackResponse = { id: "resp", choices: [] } as never;
    client.createCompletion
      .mockRejectedValueOnce(new Error("model not found"))
      .mockRejectedValueOnce(new Error("model not found"))
      .mockResolvedValueOnce(fallbackResponse);

    const response = await provider.createCompletion({
      messages: [],
    });

    expect(response).toBe(fallbackResponse);
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.preview_fallback",
        model: "gpt-5.1-codex",
        fallbackModel: "gpt-4o-mini",
        reason: "preview_unavailable",
      }),
      AiProviderService.name,
    );
    const previewLogs = loggingService.warn.mock.calls.filter(
      ([payload]) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { event?: string }).event === "ai.preview_fallback",
    );
    expect(previewLogs).toHaveLength(1);
    expect(errorHandler.handle).not.toHaveBeenCalled();
  });

  it("reports errors when fallback also fails", async () => {
    client.createCompletion
      .mockRejectedValueOnce(new Error("model not found"))
      .mockRejectedValueOnce(new Error("model not found"))
      .mockRejectedValueOnce(new Error("fallback failed"))
      .mockRejectedValueOnce(new Error("fallback failed"));

    await expect(provider.createCompletion({ messages: [] })).rejects.toThrow(
      "fallback failed",
    );

    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "completion",
        metadata: expect.objectContaining({ model: "gpt-4o-mini" }),
      }),
    );
  });

  it("retries once when the provider fails before succeeding", async () => {
    const response = { id: "resp", choices: [] } as never;
    client.createCompletion
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(response);

    const result = await provider.createCompletion({ messages: [] });

    expect(result).toBe(response);
    expect(client.createCompletion).toHaveBeenCalledTimes(2);
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai_budget_triggered",
        budget: "AI_MAX_RETRIES",
        limit: mockConfig.aiMaxRetries,
        attempt: 1,
      }),
      AiProviderService.name,
    );
  });
});
