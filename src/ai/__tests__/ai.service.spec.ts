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
import { ConversationLifecycleService } from "../../conversations/conversation-lifecycle.service";
import { ConversationsService } from "../../conversations/conversations.service";
import { runWithRequestContext } from "../../common/context/request-context";
import { CommunicationChannel } from "@prisma/client";
import { AiPromptOrchestrationService } from "../prompts/prompt-orchestration.service";
import { ToolExecutorRegistryService } from "../tools/tool-executor.registry";
import { RouteConversationToolExecutor } from "../tools/route-conversation.executor";
import { AiCreateJobToolExecutor } from "../tools/create-job.executor";
import { AiExtractionService } from "../ai-extraction.service";
import { TriageOrchestratorService } from "../triage-orchestrator.service";
import { ToolDispatchService } from "../tool-dispatch.service";

jest.mock("fs", () => ({
  readFileSync: jest.fn((path: string) => {
    const value = String(path);
    if (value.includes("routerPrompt.txt")) {
      return "Router prompt";
    }
    if (value.includes("bookingPrompt.txt")) {
      return "Booking prompt";
    }
    if (value.includes("faqPrompt.txt")) {
      return "FAQ prompt";
    }
    return "System prompt";
  }),
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
  const routeTool = {
    type: "function",
    function: { name: "route_conversation" },
  };
  const createJobTool = {
    type: "function",
    function: { name: "create_job" },
  };

  let aiProvider: jest.Mocked<IAiProvider>;
  let errorHandler: jest.Mocked<AiErrorHandler>;
  let loggingService: jest.Mocked<LoggingService>;
  let sanitizationService: SanitizationService;
  let toolSelector: ToolSelectorStub;
  let promptOrchestration: AiPromptOrchestrationService;
  let toolExecutorRegistry: ToolExecutorRegistryService;
  let jobsRepository: jest.Mocked<IJobRepository>;
  let tenantsService: jest.Mocked<TenantsService>;
  let callLogService: jest.Mocked<CallLogService>;
  let conversationLifecycleService: jest.Mocked<ConversationLifecycleService>;
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
    toolSelector = new ToolSelectorStub();
    toolExecutorRegistry = new ToolExecutorRegistryService();
    jobsRepository = {
      createJobFromToolCall: jest.fn(),
      listJobs: jest.fn(),
    } as unknown as jest.Mocked<IJobRepository>;
    tenantsService = {
      getTenantContext: jest.fn(),
      createTenant: jest.fn(),
      getTenantById: jest.fn(),
      getTenantFeePolicy: jest.fn(),
      syncTenantFeePolicy: jest.fn(),
      updateTenantFeeSettings: jest.fn(),
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
    conversationLifecycleService = {
      ensureConversation: jest.fn(),
      ensureSmsConversation: jest.fn(),
      ensureVoiceConsentConversation: jest.fn(),
      completeVoiceConversationByCallSid: jest.fn(),
      linkJobToConversation: jest.fn(),
    } as unknown as jest.Mocked<ConversationLifecycleService>;
    conversationsService = {
      getConversationById: jest.fn(),
      setAiRouteIntent: jest.fn(),
    } as unknown as jest.Mocked<ConversationsService>;
    conversationLifecycleService.ensureConversation.mockResolvedValue({
      id: "conversation-1",
      collectedData: {},
    } as never);
    conversationsService.setAiRouteIntent.mockResolvedValue({
      id: "conversation-1",
      collectedData: { aiRoute: { intent: "BOOKING" } },
    } as never);
    toolExecutorRegistry.register(
      new RouteConversationToolExecutor(
        conversationsService as unknown as ConversationsService,
      ),
    );
    toolExecutorRegistry.register(
      new AiCreateJobToolExecutor(
        jobsRepository,
        conversationLifecycleService as unknown as ConversationLifecycleService,
        callLogService as unknown as CallLogService,
        loggingService as unknown as LoggingService,
      ),
    );
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
      firebaseProjectId: "",
      googleCloudProject: "",
      voiceEnabled: false,
      twilioAccountSid: "",
      twilioAuthToken: "",
      twilioPhoneNumber: "",
      twilioSignatureCheck: true,
      twilioWebhookBaseUrl: "",
      demoTenantId: "",
      voiceMaxTurns: 6,
      voiceMaxDurationSec: 180,
      voiceAddressMinConfidence: 0.7,
      voiceSoftConfirmMinConfidence: 0.85,
      voiceStreamingEnabled: false,
      voiceStreamingKeepAliveSec: 60,
      voiceStreamingTrack: "inbound",
      addressValidationProvider: "none",
      googlePlacesApiKey: "",
      googleSpeechEnabled: false,
      googleSpeechLanguageCode: "en-US",
      googleSpeechModel: "phone_call",
      googleSpeechUseEnhanced: true,
      googleSpeechEncoding: "MULAW",
      googleSpeechSampleRateHz: 8000,
      googleSpeechInterimResults: true,
      googleTtsEnabled: false,
      googleTtsLanguageCode: "en-US",
      googleTtsVoiceName: "en-US-Studio-O",
      googleTtsAudioEncoding: "MP3",
      googleTtsSpeakingRate: 1,
      googleTtsPitch: 0,
      googleTtsVolumeGainDb: 0,
      googleTtsBucket: "",
      googleTtsSignedUrlTtlSec: 900,
      corsOrigins: ["http://localhost:3000"],
    } as ReturnType<typeof appConfig>;
    promptOrchestration = new AiPromptOrchestrationService(
      loggingService as unknown as LoggingService,
      config,
    );

    service = new AiService(
      errorHandler,
      sanitizationService,
      tenantsService,
      callLogService,
      conversationLifecycleService,
      conversationsService,
      new AiExtractionService(aiProvider, loggingService, sanitizationService, config),
      new TriageOrchestratorService(
        aiProvider,
        loggingService,
        toolSelector as unknown as ToolSelectorService,
        promptOrchestration,
        new ToolDispatchService(loggingService, toolExecutorRegistry, errorHandler),
        callLogService,
        errorHandler,
        config,
      ),
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

  it("uses the router prompt and router-only tool set for text conversations with no route", async () => {
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-router-lane",
      choices: [
        {
          message: { role: "assistant", content: "How can we help today?" },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "Need help", {
      channel: CommunicationChannel.SMS,
    });

    const request = aiProvider.createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      tools?: Array<{ function?: { name?: string } }>;
      context?: { channel?: string; lane?: string };
    };
    expect(request.messages[0]?.content).toBe("Router prompt");
    expect((request.tools ?? []).map((tool) => tool.function?.name)).toEqual([
      "route_conversation",
    ]);
    expect(request.context).toEqual({
      channel: "TEXT",
      lane: "TRIAGE_ROUTER",
    });
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.triage_lane_selected",
        tenantId,
        lane: "TRIAGE_ROUTER",
        routerFlowEnabled: true,
      }),
      TriageOrchestratorService.name,
    );
  });

  it("falls back to legacy text flow when SMS router rollout is disabled", async () => {
    config.aiRouterFlowSmsEnabled = false;
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-sms-legacy",
      choices: [
        {
          message: { role: "assistant", content: "Legacy SMS reply." },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "Need help", {
      channel: CommunicationChannel.SMS,
    });

    const request = aiProvider.createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      tools?: Array<{ function?: { name?: string } }>;
      context?: { channel?: string; lane?: string };
    };
    expect(request.messages[0]?.content).toBe("System prompt");
    expect((request.tools ?? []).map((tool) => tool.function?.name)).toEqual([
      "create_job",
    ]);
    expect(request.context).toEqual({
      channel: "TEXT",
      lane: "TRIAGE_TEXT_FALLBACK",
    });
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.router_flow_disabled",
        tenantId,
        channel: CommunicationChannel.SMS,
        reason: "sms_disabled",
      }),
      TriageOrchestratorService.name,
    );
  });

  it("falls back to legacy text flow when router rollout is allowlist-only and tenant is not listed", async () => {
    config.aiRouterFlowAllowlistOnly = true;
    config.aiRouterFlowTenantAllowlist = ["another-tenant"];
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-allowlist-legacy",
      choices: [
        {
          message: { role: "assistant", content: "Legacy webchat reply." },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "Need help", {
      channel: CommunicationChannel.WEBCHAT,
    });

    const request = aiProvider.createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      tools?: Array<{ function?: { name?: string } }>;
      context?: { channel?: string; lane?: string };
    };
    expect(request.messages[0]?.content).toBe("System prompt");
    expect((request.tools ?? []).map((tool) => tool.function?.name)).toEqual([
      "create_job",
    ]);
    expect(request.context).toEqual({
      channel: "TEXT",
      lane: "TRIAGE_TEXT_FALLBACK",
    });
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.router_flow_disabled",
        tenantId,
        channel: CommunicationChannel.WEBCHAT,
        reason: "tenant_not_allowlisted",
      }),
      TriageOrchestratorService.name,
    );
  });

  it("uses the booking prompt and booking lane tools when a BOOKING route is already set", async () => {
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    conversationLifecycleService.ensureConversation.mockResolvedValue({
      id: "conversation-1",
      collectedData: { aiRoute: { intent: "BOOKING" } },
    } as never);
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-booking-lane",
      choices: [
        {
          message: { role: "assistant", content: "What issue are you having?" },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "I need an appointment");

    const request = aiProvider.createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      tools?: Array<{ function?: { name?: string } }>;
    };
    expect(request.messages[0]?.content).toBe("Booking prompt");
    expect((request.tools ?? []).map((tool) => tool.function?.name)).toEqual([
      "route_conversation",
      "create_job",
    ]);
  });

  it("uses the faq prompt and router-only tool set when an FAQ route is already set", async () => {
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    conversationLifecycleService.ensureConversation.mockResolvedValue({
      id: "conversation-1",
      collectedData: { aiRoute: { intent: "FAQ" } },
    } as never);
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-faq-lane",
      choices: [
        {
          message: { role: "assistant", content: "We can help with that." },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "What are your hours?");

    const request = aiProvider.createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      tools?: Array<{ function?: { name?: string } }>;
    };
    expect(request.messages[0]?.content).toBe("FAQ prompt");
    expect((request.tools ?? []).map((tool) => tool.function?.name)).toEqual([
      "route_conversation",
    ]);
  });

  it("persists route_conversation and performs a second completion in the same turn", async () => {
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    conversationsService.setAiRouteIntent.mockResolvedValue({
      id: "conversation-1",
      collectedData: { aiRoute: { intent: "BOOKING" } },
    } as never);
    aiProvider.createCompletion
      .mockResolvedValueOnce({
        id: "resp-route-1",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-route-1",
                  type: "function",
                  function: {
                    name: "route_conversation",
                    arguments: JSON.stringify({ intent: "BOOKING" }),
                  },
                },
              ],
            },
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        id: "resp-route-2",
        choices: [
          {
            message: {
              role: "assistant",
              content: "What issue are you dealing with today?",
            },
          },
        ],
      } as never);

    const response = await service.triage(tenantId, sessionId, "Need service");

    expect(response).toEqual({
      status: "reply",
      reply: "What issue are you dealing with today?",
    });
    expect(aiProvider.createCompletion).toHaveBeenCalledTimes(2);
    expect(conversationsService.setAiRouteIntent).toHaveBeenCalledWith({
      tenantId,
      conversationId: "conversation-1",
      intent: "BOOKING",
    });

    const firstRequest = aiProvider.createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const secondRequest = aiProvider.createCompletion.mock.calls[1]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(firstRequest.messages[0]?.content).toBe("Router prompt");
    expect(secondRequest.messages[0]?.content).toBe("Booking prompt");
    expect(
      secondRequest.messages.some(
        (message) =>
          message.role === "system" &&
          message.content.includes("already set to BOOKING"),
      ),
    ).toBe(true);
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.route_changed",
        tenantId,
        previousIntent: null,
        nextIntent: "BOOKING",
      }),
      TriageOrchestratorService.name,
    );
  });

  it("supports router to booking followed by create_job in the same user turn", async () => {
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    conversationsService.setAiRouteIntent.mockResolvedValue({
      id: "conversation-1",
      collectedData: { aiRoute: { intent: "BOOKING" } },
    } as never);
    aiProvider.createCompletion
      .mockResolvedValueOnce({
        id: "resp-route-job-1",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-route-job-1",
                  type: "function",
                  function: {
                    name: "route_conversation",
                    arguments: JSON.stringify({ intent: "BOOKING" }),
                  },
                },
              ],
            },
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        id: "resp-route-job-2",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-route-job-2",
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
      id: "job-route-1",
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

    const response = await service.triage(tenantId, sessionId, "Book a repair");

    expect(response).toEqual({
      status: "job_created",
      job: jobRecord,
      message: "Job created successfully.",
    });
    expect(aiProvider.createCompletion).toHaveBeenCalledTimes(2);
    expect(conversationsService.setAiRouteIntent).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "BOOKING" }),
    );
    expect(jobsRepository.createJobFromToolCall).toHaveBeenCalled();
  });

  it("fails closed when route_conversation tool args are invalid", async () => {
    toolSelector.getEnabledToolsForTenant.mockReturnValue([routeTool] as never);
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-bad-route",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-bad-route",
                type: "function",
                function: {
                  name: "route_conversation",
                  arguments: "{bad-json}",
                },
              },
            ],
          },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "I need to book");

    expect(conversationsService.setAiRouteIntent).not.toHaveBeenCalled();
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "tool_call",
        tenantId,
        toolName: "route_conversation",
      }),
    );
  });

  it("allows re-routing from FAQ to BOOKING on a later text turn", async () => {
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    conversationLifecycleService.ensureConversation.mockResolvedValue({
      id: "conversation-1",
      collectedData: { aiRoute: { intent: "FAQ" } },
    } as never);
    conversationsService.setAiRouteIntent.mockResolvedValue({
      id: "conversation-1",
      collectedData: { aiRoute: { intent: "BOOKING" } },
    } as never);
    aiProvider.createCompletion
      .mockResolvedValueOnce({
        id: "resp-reroute-1",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-reroute-1",
                  type: "function",
                  function: {
                    name: "route_conversation",
                    arguments: JSON.stringify({ intent: "BOOKING" }),
                  },
                },
              ],
            },
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        id: "resp-reroute-2",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Great, let's get that scheduled.",
            },
          },
        ],
      } as never);

    const response = await service.triage(tenantId, sessionId, "Actually book it");

    expect(response).toEqual({
      status: "reply",
      reply: "Great, let's get that scheduled.",
    });
    const firstRequest = aiProvider.createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const secondRequest = aiProvider.createCompletion.mock.calls[1]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(firstRequest.messages[0]?.content).toBe("FAQ prompt");
    expect(secondRequest.messages[0]?.content).toBe("Booking prompt");
    expect(conversationsService.setAiRouteIntent).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "BOOKING" }),
    );
  });

  it("fails closed when the model tries to re-route twice in the same turn", async () => {
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    conversationsService.setAiRouteIntent.mockResolvedValue({
      id: "conversation-1",
      collectedData: { aiRoute: { intent: "BOOKING" } },
    } as never);
    aiProvider.createCompletion
      .mockResolvedValueOnce({
        id: "resp-loop-1",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-loop-1",
                  type: "function",
                  function: {
                    name: "route_conversation",
                    arguments: JSON.stringify({ intent: "BOOKING" }),
                  },
                },
              ],
            },
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        id: "resp-loop-2",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-loop-2",
                  type: "function",
                  function: {
                    name: "route_conversation",
                    arguments: JSON.stringify({ intent: "BOOKING" }),
                  },
                },
              ],
            },
          },
        ],
      } as never);

    const response = await service.triage(tenantId, sessionId, "I need service");

    expect(response).toBeUndefined();
    expect(aiProvider.createCompletion).toHaveBeenCalledTimes(2);
    expect(conversationsService.setAiRouteIntent).toHaveBeenCalledTimes(1);
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "tool_call",
        tenantId,
        toolName: "route_conversation",
      }),
    );
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.invalid_output",
        tenantId,
        reason: "tool_args_invalid",
      }),
      ToolDispatchService.name,
    );
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.route_loop_guard_triggered",
        tenantId,
      }),
      ToolDispatchService.name,
    );
  });

  it("keeps the voice path on the legacy prompt and excludes the router tool", async () => {
    toolSelector.getEnabledToolsForTenant.mockReturnValue([
      routeTool,
      createJobTool,
    ] as never);
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-voice-legacy",
      choices: [
        {
          message: { role: "assistant", content: "Voice reply." },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "Hello", {
      channel: CommunicationChannel.VOICE,
    });

    const request = aiProvider.createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      tools?: Array<{ function?: { name?: string } }>;
      context?: { channel?: string; lane?: string };
    };
    expect(request.messages[0]?.content).toBe("System prompt");
    expect((request.tools ?? []).map((tool) => tool.function?.name)).toEqual([
      "create_job",
    ]);
    expect(request.context).toEqual({
      channel: "VOICE",
      lane: "TRIAGE_VOICE",
    });
  });

  it("returns unsupported_tool when the model calls an unregistered tool", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-unsupported",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-unsupported",
                type: "function",
                function: {
                  name: "lookup_price_range",
                  arguments: JSON.stringify({ issueCategory: "HEATING" }),
                },
              },
            ],
          },
        },
      ],
    } as never);

    const response = await service.triage(tenantId, sessionId, "How much?");

    expect(response).toEqual({
      status: "unsupported_tool",
      toolName: "lookup_price_range",
      rawArgs: JSON.stringify({ issueCategory: "HEATING" }),
    });
    expect(errorHandler.handle).not.toHaveBeenCalled();
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.unsupported_tool_called",
        tenantId,
        toolName: "lookup_price_range",
      }),
      ToolDispatchService.name,
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
    expect(conversationLifecycleService.linkJobToConversation).toHaveBeenCalledWith(
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

  it("blocks create_job tool calls on voice and returns SMS handoff", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-voice-1",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-voice-1",
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

    const replyText =
      "Thanks — I’ll text you to confirm details and secure the appointment.";

    const response = await runWithRequestContext(
      {
        tenantId,
        requestId: "req-voice-1",
        callSid: "CA123",
        conversationId: "conversation-1",
        channel: "VOICE",
      },
      () =>
        service.triage(tenantId, sessionId, "Create job.", {
          channel: CommunicationChannel.VOICE,
        }),
    );

    expect(response).toEqual({
      status: "reply",
      reply: replyText,
      outcome: "sms_handoff",
      reason: "voice_tool_blocked",
    });
    expect(jobsRepository.createJobFromToolCall).not.toHaveBeenCalled();
    expect(conversationLifecycleService.linkJobToConversation).not.toHaveBeenCalled();
    expect(callLogService.clearSession).not.toHaveBeenCalled();
    expect(callLogService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        sessionId,
        conversationId: "conversation-1",
        aiResponse: replyText,
        metadata: expect.objectContaining({ toolName: "create_job" }),
      }),
    );
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.tool_blocked",
        tenantId,
        callSid: "CA123",
        conversationId: "conversation-1",
        toolName: "create_job",
      }),
      AiService.name,
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
      TriageOrchestratorService.name,
    );
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "triage",
        tenantId,
      }),
    );
  });

  it("fails closed when AI returns too many tool calls", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      id: "resp-too-many-tools",
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
                  arguments: JSON.stringify({ customerName: "Alice" }),
                },
              },
              {
                id: "call-2",
                type: "function",
                function: {
                  name: "route_conversation",
                  arguments: JSON.stringify({ intent: "BOOKING" }),
                },
              },
            ],
          },
        },
      ],
    } as never);

    await service.triage(tenantId, sessionId, "Book me");

    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai_budget_triggered",
        budget: "AI_MAX_TOOL_CALLS",
        limit: config.aiMaxToolCalls,
      }),
      TriageOrchestratorService.name,
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

    await runWithRequestContext(
      {
        requestId: "req-voice-1",
        tenantId,
        callSid: "CA123",
        conversationId: "conversation-1",
        channel: "VOICE",
      },
      () => service.triage(tenantId, sessionId, "Disallowed request."),
    );

    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.refusal",
        tenantId,
        reason: "policy_violation",
        callSid: "CA123",
        conversationId: "conversation-1",
      }),
      TriageOrchestratorService.name,
    );
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "triage",
        tenantId,
      }),
    );
  });

  it("extracts address candidates from AI responses", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            role: "assistant",
            content:
              '{"address":" 123  Main St. ","confidence":0.82}',
          },
        },
      ],
    } as never);

    const result = await service.extractAddressCandidate(
      tenantId,
      "My address is 123 Main St.",
    );

    expect(result).toEqual({ address: "123 Main St.", confidence: 0.82 });
    const request = aiProvider.createCompletion.mock.calls[0]?.[0] as {
      context?: { channel?: string; lane?: string };
    };
    expect(request.context).toEqual({
      channel: "TEXT",
      lane: "EXTRACTION_ADDRESS",
    });
  });

  it("normalizes confidence for address candidates", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            role: "assistant",
            content:
              '{"address":"456 Elm St","confidence":82}',
          },
        },
      ],
    } as never);

    const result = await service.extractAddressCandidate(
      tenantId,
      "Address is 456 Elm St.",
    );

    expect(result).toEqual({ address: "456 Elm St", confidence: 0.82 });
  });

  it("returns null when address extraction JSON is invalid", async () => {
    aiProvider.createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            role: "assistant",
            content: "not-json",
          },
        },
      ],
    } as never);

    const result = await service.extractAddressCandidate(
      tenantId,
      "Address is 789 Oak St.",
    );

    expect(result).toBeNull();
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.address_extraction_failed",
        tenantId,
        reason: "invalid_json",
      }),
      AiExtractionService.name,
    );
  });
});

describe("AiProviderService", () => {
  const mockConfig: ReturnType<typeof appConfig> = {
    environment: "test",
    openAiApiKey: "test",
    enablePreviewModel: true,
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
    port: 3000,
    databaseUrl: "postgres://user:pass@localhost:5432/db",
    adminApiToken: "token",
    devAuthEnabled: true,
    devAuthSecret: "dev-auth-secret",
    identityIssuer: "http://localhost",
    identityAudience: "signmons",
    voiceAddressMinConfidence: 0.7,
    corsOrigins: ["http://localhost:3000"],
  };

  let client: jest.Mocked<IAiProviderClient>;
  let errorHandler: jest.Mocked<AiErrorHandler>;
  let loggingService: jest.Mocked<LoggingService>;
  let providerConfig: ReturnType<typeof appConfig>;
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
    providerConfig = { ...mockConfig };

    provider = new AiProviderService(
      client,
      providerConfig,
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
        limit: providerConfig.aiMaxRetries,
        attempt: 1,
      }),
      AiProviderService.name,
    );
  });

  it("prefers a lane-specific router model over channel and preview/default models", async () => {
    const response = { id: "resp", choices: [] } as never;
    providerConfig.aiRouterModel = "gpt-router";
    providerConfig.aiTextModel = "gpt-text";
    client.createCompletion.mockResolvedValueOnce(response);

    await provider.createCompletion({
      messages: [],
      context: { channel: "TEXT", lane: "TRIAGE_ROUTER" },
    });

    const payload = client.createCompletion.mock.calls[0]?.[0];
    expect(payload?.model).toBe("gpt-router");
  });

  it("falls back to the channel model when no lane-specific model is configured", async () => {
    const response = { id: "resp", choices: [] } as never;
    providerConfig.aiTextModel = "gpt-text";
    client.createCompletion.mockResolvedValueOnce(response);

    await provider.createCompletion({
      messages: [],
      context: { channel: "TEXT", lane: "TRIAGE_FAQ" },
    });

    const payload = client.createCompletion.mock.calls[0]?.[0];
    expect(payload?.model).toBe("gpt-text");
  });

  it("uses the extraction model for extraction lanes", async () => {
    const response = { id: "resp", choices: [] } as never;
    providerConfig.aiExtractionModel = "gpt-extract";
    providerConfig.aiTextModel = "gpt-text";
    client.createCompletion.mockResolvedValueOnce(response);

    await provider.createCompletion({
      messages: [],
      context: { channel: "TEXT", lane: "EXTRACTION_ADDRESS" },
    });

    const payload = client.createCompletion.mock.calls[0]?.[0];
    expect(payload?.model).toBe("gpt-extract");
  });

  it("uses the voice channel model for legacy voice triage when configured", async () => {
    const response = { id: "resp", choices: [] } as never;
    providerConfig.aiVoiceModel = "gpt-voice";
    client.createCompletion.mockResolvedValueOnce(response);

    await provider.createCompletion({
      messages: [],
      context: { channel: "VOICE", lane: "TRIAGE_VOICE" },
    });

    const payload = client.createCompletion.mock.calls[0]?.[0];
    expect(payload?.model).toBe("gpt-voice");
  });

  it("omits toolChoice when no tools are provided", async () => {
    const response = { id: "resp", choices: [] } as never;
    client.createCompletion.mockResolvedValueOnce(response);

    await provider.createCompletion({
      messages: [],
      toolChoice: "none",
    });

    const payload = client.createCompletion.mock.calls[0]?.[0];
    expect(payload?.toolChoice).toBeUndefined();
  });
});
