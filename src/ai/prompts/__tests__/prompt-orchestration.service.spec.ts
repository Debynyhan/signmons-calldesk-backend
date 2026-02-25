import { jest } from "@jest/globals";
import { readFileSync } from "fs";
import { CommunicationChannel } from "@prisma/client";
import appConfig from "../../../config/app.config";
import { LoggingService } from "../../../logging/logging.service";
import { AiPromptOrchestrationService } from "../prompt-orchestration.service";
import type { AiToolDefinition } from "../../types/ai-completion.types";

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
}));

type AppConfigLike = ReturnType<typeof appConfig>;

const readFileSyncMock = readFileSync as unknown as jest.Mock;

const makeConfig = (
  overrides: Partial<AppConfigLike> = {},
): AppConfigLike =>
  ({
    aiRouterFlowEnabled: true,
    aiRouterFlowSmsEnabled: true,
    aiRouterFlowWebchatEnabled: true,
    aiRouterFlowAllowlistOnly: false,
    aiRouterFlowTenantAllowlist: [],
    ...overrides,
  }) as AppConfigLike;

const makeLoggingService = () =>
  ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as jest.Mocked<LoggingService>;

const makeTools = (): AiToolDefinition[] => [
  {
    type: "function",
    function: { name: "route_conversation" },
  },
  {
    type: "function",
    function: { name: "create_job" },
  },
  {
    type: "function",
    function: { name: "lookup_price_range" },
  },
];

describe("AiPromptOrchestrationService", () => {
  const tenantId = "tenant-1";

  beforeEach(() => {
    readFileSyncMock.mockReset();
    readFileSyncMock.mockImplementation((path: unknown) => {
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
      if (value.includes("calldeskSystemPrompt.txt")) {
        return "Legacy prompt";
      }
      throw new Error(`Unexpected path: ${value}`);
    });
  });

  it("returns enabled router flow for supported text channels by default", () => {
    const service = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig(),
    );

    expect(
      service.getTextRouterFlowDecision(tenantId, CommunicationChannel.SMS),
    ).toEqual({
      enabled: true,
      reason: "enabled",
    });
    expect(
      service.getTextRouterFlowDecision(tenantId, CommunicationChannel.WEBCHAT),
    ).toEqual({
      enabled: true,
      reason: "enabled",
    });
    expect(service.getTextRouterFlowDecision(tenantId)).toEqual({
      enabled: true,
      reason: "enabled",
    });
  });

  it("returns disable reasons for voice, unsupported channel, and global/channel gates", () => {
    const globalOff = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig({ aiRouterFlowEnabled: false }),
    );
    expect(
      globalOff.getTextRouterFlowDecision(tenantId, CommunicationChannel.SMS),
    ).toEqual({
      enabled: false,
      reason: "global_disabled",
    });

    const smsOff = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig({ aiRouterFlowSmsEnabled: false }),
    );
    expect(
      smsOff.getTextRouterFlowDecision(tenantId, CommunicationChannel.SMS),
    ).toEqual({
      enabled: false,
      reason: "sms_disabled",
    });

    const webchatOff = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig({ aiRouterFlowWebchatEnabled: false }),
    );
    expect(
      webchatOff.getTextRouterFlowDecision(tenantId, CommunicationChannel.WEBCHAT),
    ).toEqual({
      enabled: false,
      reason: "webchat_disabled",
    });
    expect(webchatOff.getTextRouterFlowDecision(tenantId)).toEqual({
      enabled: false,
      reason: "webchat_disabled",
    });

    const service = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig(),
    );
    expect(
      service.getTextRouterFlowDecision(tenantId, CommunicationChannel.VOICE),
    ).toEqual({
      enabled: false,
      reason: "voice_channel",
    });
    expect(
      service.getTextRouterFlowDecision(tenantId, CommunicationChannel.EMAIL),
    ).toEqual({
      enabled: false,
      reason: "unsupported_channel",
    });
  });

  it("enforces allowlist-only router rollout by tenant", () => {
    const service = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig({
        aiRouterFlowAllowlistOnly: true,
        aiRouterFlowTenantAllowlist: ["tenant-2", " tenant-3 "],
      }),
    );

    expect(
      service.getTextRouterFlowDecision("tenant-2", CommunicationChannel.SMS),
    ).toEqual({
      enabled: true,
      reason: "enabled",
    });
    expect(
      service.getTextRouterFlowDecision("tenant-3", CommunicationChannel.WEBCHAT),
    ).toEqual({
      enabled: true,
      reason: "enabled",
    });
    expect(
      service.getTextRouterFlowDecision(tenantId, CommunicationChannel.SMS),
    ).toEqual({
      enabled: false,
      reason: "tenant_not_allowlisted",
    });
  });

  it("selects prompt and triage lane by route intent, and falls back to legacy when router flow is disabled", () => {
    const service = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig(),
    );

    expect(service.selectSystemPrompt(CommunicationChannel.SMS, null)).toBe(
      "Router prompt",
    );
    expect(service.selectSystemPrompt(CommunicationChannel.SMS, "BOOKING")).toBe(
      "Booking prompt",
    );
    expect(service.selectSystemPrompt(CommunicationChannel.SMS, "FAQ")).toBe(
      "FAQ prompt",
    );
    expect(service.selectSystemPrompt(CommunicationChannel.VOICE, "BOOKING")).toBe(
      "Legacy prompt",
    );
    expect(
      service.selectSystemPrompt(CommunicationChannel.SMS, "BOOKING", {
        routerFlowEnabled: false,
      }),
    ).toBe("Legacy prompt");

    expect(service.selectTriageLane(CommunicationChannel.SMS, null)).toBe(
      "TRIAGE_ROUTER",
    );
    expect(service.selectTriageLane(CommunicationChannel.SMS, "BOOKING")).toBe(
      "TRIAGE_BOOKING",
    );
    expect(service.selectTriageLane(CommunicationChannel.SMS, "FAQ")).toBe(
      "TRIAGE_FAQ",
    );
    expect(service.selectTriageLane(CommunicationChannel.VOICE, "FAQ")).toBe(
      "TRIAGE_LEGACY",
    );
    expect(
      service.selectTriageLane(CommunicationChannel.SMS, "BOOKING", {
        routerFlowEnabled: false,
      }),
    ).toBe("TRIAGE_LEGACY");
  });

  it("filters tools per lane and excludes route_conversation for voice/legacy fallback", () => {
    const service = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig(),
    );
    const tools = makeTools();

    expect(
      service
        .filterToolsForLane(tools, CommunicationChannel.SMS, null)
        .map((tool) => tool.function.name),
    ).toEqual(["route_conversation"]);

    expect(
      service
        .filterToolsForLane(tools, CommunicationChannel.SMS, "BOOKING")
        .map((tool) => tool.function.name),
    ).toEqual(["route_conversation", "create_job"]);

    expect(
      service
        .filterToolsForLane(tools, CommunicationChannel.VOICE, "BOOKING")
        .map((tool) => tool.function.name),
    ).toEqual(["create_job", "lookup_price_range"]);

    expect(
      service
        .filterToolsForLane(tools, CommunicationChannel.SMS, "BOOKING", {
          routerFlowEnabled: false,
        })
        .map((tool) => tool.function.name),
    ).toEqual(["create_job", "lookup_price_range"]);
  });

  it("builds triage messages with tenant prompt, continuation note, history, and latest user input", () => {
    const service = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig(),
    );

    const messages = service.buildTriageMessages({
      systemPrompt: "Router prompt",
      tenantContextPrompt: "Tenant prompt",
      continuationNote: "Continue in BOOKING lane",
      conversationHistory: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "How can I help?" },
      ],
      userMessage: "Need an appointment",
    });

    expect(messages).toEqual([
      { role: "system", content: "Router prompt" },
      { role: "system", content: "Tenant prompt" },
      { role: "system", content: "Continue in BOOKING lane" },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "How can I help?" },
      { role: "user", content: "Need an appointment" },
    ]);
  });

  it("parses route intent from conversation collectedData", () => {
    const service = new AiPromptOrchestrationService(
      makeLoggingService(),
      makeConfig(),
    );

    expect(
      service.getConversationRouteIntent({
        aiRoute: { intent: "BOOKING" },
      }),
    ).toBe("BOOKING");
    expect(
      service.getConversationRouteIntent({
        aiRoute: { intent: "INVALID" },
      }),
    ).toBeNull();
    expect(service.getConversationRouteIntent(null)).toBeNull();
  });

  it("logs prompt load errors and falls back to legacy when a specialized prompt is missing", () => {
    const loggingService = makeLoggingService();
    readFileSyncMock.mockImplementation((path: unknown) => {
      const value = String(path);
      if (value.includes("bookingPrompt.txt")) {
        throw new Error("missing booking prompt");
      }
      if (value.includes("faqPrompt.txt")) {
        return "FAQ prompt";
      }
      if (value.includes("routerPrompt.txt")) {
        return "Router prompt";
      }
      if (value.includes("calldeskSystemPrompt.txt")) {
        return "Legacy prompt";
      }
      throw new Error(`Unexpected path: ${value}`);
    });

    const service = new AiPromptOrchestrationService(
      loggingService,
      makeConfig(),
    );

    expect(service.selectSystemPrompt(CommunicationChannel.SMS, "BOOKING")).toBe(
      "Legacy prompt",
    );
    expect(loggingService.error).toHaveBeenCalledWith(
      "Failed to load prompt: bookingPrompt.txt",
      expect.any(Error),
      AiPromptOrchestrationService.name,
    );
  });
});
