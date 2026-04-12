import { jest } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";
import { TriageOrchestratorService } from "../triage-orchestrator.service";
import { ToolDispatchService } from "../tool-dispatch.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import { CallLogService } from "../../logging/call-log.service";
import type { IAiProvider } from "../interfaces/ai-provider.interface";
import { AiErrorHandler } from "../ai-error.handler";
import { LoggingService } from "../../logging/logging.service";
import { AiPromptOrchestrationService } from "../prompts/prompt-orchestration.service";
import { ToolExecutorRegistryService } from "../tools/tool-executor.registry";
import { ToolSelectorService } from "../tools/tool-selector.service";
import appConfig from "../../config/app.config";
import { CommunicationChannel } from "@prisma/client";
import type { AiChatMessageParam } from "../types/ai-completion.types";

jest.mock("fs", () => ({
  readFileSync: jest.fn((path: string) => {
    const value = String(path);
    if (value.includes("routerPrompt.txt")) {
      return "Router prompt";
    }
    if (value.includes("bookingPrompt.txt")) {
      return "Booking prompt";
    }
    return "System prompt";
  }),
  existsSync: jest.fn(() => true),
}));

describe("TriageOrchestratorService", () => {
  const tenantId = "tenant-orch-1";
  const sessionId = "session-orch-1";
  const conversationId = "conv-orch-1";

  let aiProvider: jest.Mocked<IAiProvider>;
  let loggingService: jest.Mocked<LoggingService>;
  let toolSelector: { getEnabledToolsForTenant: jest.Mock };
  let promptOrchestration: AiPromptOrchestrationService;
  let toolExecutorRegistry: ToolExecutorRegistryService;
  let toolDispatch: ToolDispatchService;
  let callLogService: jest.Mocked<CallLogService>;
  let errorHandler: jest.Mocked<AiErrorHandler>;
  let config: ReturnType<typeof appConfig>;
  let service: TriageOrchestratorService;

  const baseParams = {
    tenantId,
    sessionId,
    conversationId,
    collectedData: null as Record<string, unknown> | null,
    tenantContextPrompt: "Tenant context.",
    conversationHistory: [] as AiChatMessageParam[],
    userMessage: "Hello there",
    originalUserMessage: "Hello there",
    channel: undefined as CommunicationChannel | undefined,
    incomingMessageLength: 11,
  };

  beforeEach(() => {
    aiProvider = {
      createCompletion: jest.fn(),
    } as unknown as jest.Mocked<IAiProvider>;

    loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<LoggingService>;

    toolSelector = { getEnabledToolsForTenant: jest.fn().mockReturnValue([]) };

    config = {
      environment: "test",
      openAiApiKey: "test",
      enablePreviewModel: false,
      aiDefaultModel: "gpt-4o-mini",
      aiPreviewModel: "gpt-5.1-codex",
      aiTextModel: "",
      aiVoiceModel: "",
      aiRouterModel: "",
      aiBookingModel: "",
      aiFaqModel: "",
      aiExtractionModel: "",
      aiRouterFlowEnabled: true,
      aiRouterFlowSmsEnabled: true,
      aiRouterFlowWebchatEnabled: true,
      aiRouterFlowAllowlistOnly: false,
      aiRouterFlowTenantAllowlist: [],
      enabledTools: [],
      aiMaxTokens: 800,
      aiMaxToolCalls: 1,
      aiTimeoutMs: 15000,
      aiMaxRetries: 1,
      aiVoiceReplyTemperature: 0.6,
      aiExtractionTemperature: 0.1,
      port: 3000,
      databaseUrl: "postgres://user:pass@localhost:5432/db",
      adminApiToken: "token",
      devAuthEnabled: true,
      devAuthSecret: "dev-auth-secret",
      identityIssuer: "http://localhost",
      identityAudience: "signmons",
      corsOrigins: ["http://localhost:3000"],
    } as ReturnType<typeof appConfig>;

    promptOrchestration = new AiPromptOrchestrationService(
      loggingService as unknown as LoggingService,
      config,
    );

    toolExecutorRegistry = new ToolExecutorRegistryService();

    errorHandler = {
      handle: jest.fn(),
    } as unknown as jest.Mocked<AiErrorHandler>;

    callLogService = {
      createLog: jest.fn().mockResolvedValue(undefined),
      getRecentMessages: jest.fn().mockResolvedValue([]),
      clearSession: jest.fn(),
    } as unknown as jest.Mocked<CallLogService>;

    toolDispatch = new ToolDispatchService(loggingService, toolExecutorRegistry, errorHandler);

    service = new TriageOrchestratorService(
      aiProvider,
      loggingService,
      toolSelector as unknown as ToolSelectorService,
      promptOrchestration,
      toolDispatch,
      callLogService,
      errorHandler,
      config,
    );
  });

  it("returns reply on a successful single-turn AI response", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-1",
      choices: [{ message: { role: "assistant", content: "Hello there!" } }],
    } as never);

    const result = await service.run(baseParams);

    expect(result).toEqual({ status: "reply", reply: "Hello there!" });
    expect(callLogService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        sessionId,
        conversationId,
        transcript: "Hello there",
        aiResponse: "Hello there!",
      }),
    );
  });

  it("logs triage_lane_selected trace on each turn", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-trace",
      choices: [{ message: { role: "assistant", content: "OK" } }],
    } as never);

    await service.run(baseParams);

    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ai.triage_lane_selected", tenantId }),
      TriageOrchestratorService.name,
    );
  });

  it("does not persist aiResponse for voice channel replies", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-voice",
      choices: [{ message: { role: "assistant", content: "Voice reply" } }],
    } as never);

    await service.run({ ...baseParams, channel: CommunicationChannel.VOICE });

    expect(callLogService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ aiResponse: undefined }),
    );
  });

  it("calls errorHandler when AI provider throws", async () => {
    aiProvider.createCompletion.mockRejectedValue(new Error("network failure"));

    await service.run(baseParams);

    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tenantId, stage: "triage" }),
    );
  });

  it("calls errorHandler when reply is empty", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-empty",
      choices: [{ message: { role: "assistant", content: null } }],
    } as never);

    await service.run(baseParams);

    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tenantId, stage: "triage" }),
    );
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ai.invalid_output", reason: "empty_reply" }),
      TriageOrchestratorService.name,
    );
  });

  it("calls errorHandler and logs refusal when AI refuses", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-refusal",
      choices: [
        { message: { role: "assistant", content: null, refusal: "policy_violation" } },
      ],
    } as never);

    await service.run(baseParams);

    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ai.refusal", tenantId, reason: "policy_violation" }),
      TriageOrchestratorService.name,
    );
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tenantId, stage: "triage" }),
    );
  });

  it("calls errorHandler when too many tool calls are returned", async () => {
    config.aiMaxToolCalls = 1;
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-too-many",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "create_job", arguments: "{}" } },
              { id: "c2", type: "function", function: { name: "route_conversation", arguments: "{}" } },
            ],
          },
        },
      ],
    } as never);

    await service.run(baseParams);

    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ai_budget_triggered", budget: "AI_MAX_TOOL_CALLS" }),
      TriageOrchestratorService.name,
    );
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tenantId, stage: "triage" }),
    );
  });

  it("returns unsupported_tool when no executor is registered for the tool", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-unknown",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "unknown_tool", arguments: '{"x":1}' },
              },
            ],
          },
        },
      ],
    } as never);

    const result = await service.run(baseParams);

    expect(result).toEqual(
      expect.objectContaining({ status: "unsupported_tool", toolName: "unknown_tool" }),
    );
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ai.unsupported_tool_called", toolName: "unknown_tool" }),
      ToolDispatchService.name,
    );
  });

  it("passes openAIResponseId to errorHandler when error occurs after completion", async () => {
    aiProvider.createCompletion.mockResolvedValueOnce({
      id: "resp-with-id",
      choices: [{ message: { role: "assistant", content: null } }],
    } as never);

    await service.run(baseParams);

    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ openAIResponseId: "resp-with-id" }),
    );
  });
});
