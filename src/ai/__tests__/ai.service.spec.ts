import { jest } from "@jest/globals";
import { AiService } from "../ai.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import { CallLogService } from "../../logging/call-log.service";
import type { IAiProvider } from "../interfaces/ai-provider.interface";
import { AiErrorHandler } from "../ai-error.handler";
import { LoggingService } from "../../logging/logging.service";
import type { TenantsService } from "../../tenants/interfaces/tenants-service.interface";
import { AiProviderService } from "../providers/ai-provider.service";
import type { IAiProviderClient } from "../providers/ai-provider.interface";
import appConfig from "../../config/app.config";
import { ToolSelectorService } from "../tools/tool-selector.service";
import type {
  ToolDefinition,
  ToolExecutionResult,
} from "../tools/tool.types";

jest.mock("fs", () => ({
  readFileSync: jest.fn(() => "System prompt"),
  existsSync: jest.fn(() => true),
}));

describe("AiService", () => {
  const tenantId = "8cf1e75e-14e7-4d4f-afd1-b4416a832ba1";
  const sessionId = "test-session";

  let aiProvider: jest.Mocked<IAiProvider>;
  let errorHandler: jest.Mocked<AiErrorHandler>;
  let loggingService: jest.Mocked<LoggingService>;
  let sanitizationService: SanitizationService;
  let toolSelector: ToolSelectorService;
  let tenantsService: jest.Mocked<TenantsService>;
  let callLogService: jest.Mocked<CallLogService>;
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
    toolSelector = {
      getEnabledToolsForTenant: jest.fn().mockReturnValue([]),
      getToolDefinitionForTenant: jest.fn(),
    } as unknown as ToolSelectorService;
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

    service = new AiService(
      aiProvider,
      errorHandler,
      loggingService,
      sanitizationService,
      toolSelector,
      tenantsService,
      callLogService,
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

    const jobRecord = {
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
    const toolExecute = jest.fn<
      (context: {
        tenantId: string;
        sessionId: string;
        rawArgs?: string;
      }) => Promise<ToolExecutionResult>
    >();
    toolExecute.mockResolvedValue({
      response: {
        status: "job_created",
        job: jobRecord,
        message: "Job created successfully.",
      },
      log: {
        jobId: jobRecord.id,
        transcript: JSON.stringify({
          customerName: "Alice",
          phone: "123",
          issueCategory: "HEATING",
          urgency: "EMERGENCY",
        }),
        aiResponse: JSON.stringify(jobRecord),
        metadata: { toolName: "create_job" },
      },
      clearSession: true,
    });
    (toolSelector.getToolDefinitionForTenant as jest.Mock).mockReturnValue({
      tool: {
        type: "function",
        function: {
          name: "create_job",
          description: "Create job",
        },
      },
      execute: toolExecute,
    } as ToolDefinition);

    const response = await service.triage(tenantId, sessionId, "Create job.");

    expect(response).toEqual({
      status: "job_created",
      job: jobRecord,
      message: "Job created successfully.",
    });
    expect(toolExecute).toHaveBeenCalledWith({
      tenantId,
      sessionId,
      rawArgs: expect.any(String),
    });
    expect(callLogService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        sessionId,
        jobId: jobRecord.id,
        metadata: expect.objectContaining({ toolName: "create_job" }),
      }),
    );
    expect(callLogService.clearSession).toHaveBeenCalledWith(
      tenantId,
      sessionId,
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
});

describe("AiProviderService", () => {
  const mockConfig: ReturnType<typeof appConfig> = {
    environment: "test",
    openAiApiKey: "test",
    enablePreviewModel: true,
    enabledTools: [],
    port: 3000,
    databaseUrl: "postgres://user:pass@localhost:5432/db",
    adminApiToken: "token",
    identityIssuer: "issuer",
    identityAudience: "audience",
    devAuthEnabled: false,
    devAuthSecret: "dev-secret",
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
      .mockResolvedValueOnce(fallbackResponse);

    const response = await provider.createCompletion({
      messages: [],
    });

    expect(response).toBe(fallbackResponse);
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.stringContaining("Preview model"),
      AiProviderService.name,
    );
    expect(errorHandler.handle).not.toHaveBeenCalled();
  });

  it("reports errors when fallback also fails", async () => {
    client.createCompletion
      .mockRejectedValueOnce(new Error("model not found"))
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
});
