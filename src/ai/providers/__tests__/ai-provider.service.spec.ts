import { jest } from "@jest/globals";
import { AiProviderService } from "../ai-provider.service";
import type { IAiProviderClient } from "../ai-provider.interface";
import { AiErrorHandler } from "../../ai-error.handler";
import { LoggingService } from "../../../logging/logging.service";
import appConfig from "../../../config/app.config";
import type {
  AiCompletionRequestOptions,
  AiCompletionResponse,
} from "../../types/ai-completion.types";

type AppConfigLike = ReturnType<typeof appConfig>;

const makeConfig = (overrides: Partial<AppConfigLike> = {}): AppConfigLike =>
  ({
    enablePreviewModel: true,
    aiDefaultModel: "gpt-4o-mini",
    aiPreviewModel: "gpt-5.1-codex",
    aiTextModel: "",
    aiVoiceModel: "",
    aiRouterModel: "",
    aiBookingModel: "",
    aiFaqModel: "",
    aiExtractionModel: "",
    aiMaxRetries: 0,
    aiTimeoutMs: 15000,
    ...overrides,
  }) as AppConfigLike;

const makeResponse = (overrides: Partial<AiCompletionResponse> = {}) =>
  ({
    id: "resp-1",
    choices: [
      {
        message: {
          role: "assistant",
          content: "ok",
        },
      },
    ],
    ...overrides,
  }) as AiCompletionResponse;

describe("AiProviderService (edge cases)", () => {
  let client: jest.Mocked<IAiProviderClient>;
  let errorHandler: jest.Mocked<AiErrorHandler>;
  let loggingService: jest.Mocked<LoggingService>;

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
  });

  const createProvider = (configOverrides: Partial<AppConfigLike> = {}) =>
    new AiProviderService(
      client,
      makeConfig(configOverrides),
      errorHandler,
      loggingService,
    );

  const getFirstPayload = () =>
    client.createCompletion.mock.calls[0]?.[0] as Record<string, unknown>;

  it("uses the configured default model when preview is disabled", async () => {
    const provider = createProvider({
      enablePreviewModel: false,
      aiDefaultModel: "gpt-default-custom",
    });
    client.createCompletion.mockResolvedValueOnce(makeResponse());

    await provider.createCompletion({ messages: [] });

    expect(getFirstPayload().model).toBe("gpt-default-custom");
  });

  it("trims whitespace model overrides and falls back from blank lane model to channel model", async () => {
    const provider = createProvider({
      aiRouterModel: "   ",
      aiTextModel: "  gpt-text-fast  ",
    });
    client.createCompletion.mockResolvedValueOnce(makeResponse());

    await provider.createCompletion({
      messages: [],
      context: { channel: "TEXT", lane: "TRIAGE_ROUTER" },
    });

    expect(getFirstPayload().model).toBe("gpt-text-fast");
  });

  it("falls back to preview model when channel override is blank", async () => {
    const provider = createProvider({
      enablePreviewModel: true,
      aiTextModel: "   ",
      aiPreviewModel: "gpt-preview-custom",
    });
    client.createCompletion.mockResolvedValueOnce(makeResponse());

    await provider.createCompletion({
      messages: [],
      context: { channel: "TEXT" },
    });

    expect(getFirstPayload().model).toBe("gpt-preview-custom");
  });

  it("falls back to hardcoded default/preview names when configured values are blank", async () => {
    let provider = createProvider({
      enablePreviewModel: false,
      aiDefaultModel: "   ",
    });
    client.createCompletion.mockResolvedValueOnce(makeResponse({ id: "resp-default" }));

    await provider.createCompletion({ messages: [] });
    expect(getFirstPayload().model).toBe("gpt-4o-mini");

    client.createCompletion.mockReset();
    provider = createProvider({
      enablePreviewModel: true,
      aiPreviewModel: "   ",
    });
    client.createCompletion.mockResolvedValueOnce(makeResponse({ id: "resp-preview" }));

    await provider.createCompletion({ messages: [] });
    expect(getFirstPayload().model).toBe("gpt-5.1-codex");
  });

  it("does not use preview fallback when a non-preview lane/channel model fails", async () => {
    const provider = createProvider({
      enablePreviewModel: true,
      aiTextModel: "gpt-text-custom",
      aiMaxRetries: 0,
    });
    client.createCompletion.mockRejectedValueOnce(new Error("model not found"));

    await expect(
      provider.createCompletion({
        messages: [],
        context: { channel: "TEXT" },
      }),
    ).rejects.toThrow("model not found");

    expect(client.createCompletion).toHaveBeenCalledTimes(1);
    const previewFallbackLogs = loggingService.warn.mock.calls.filter(
      ([payload]) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { event?: string }).event === "ai.preview_fallback",
    );
    expect(previewFallbackLogs).toHaveLength(0);
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        stage: "completion",
        metadata: expect.objectContaining({
          model: "gpt-text-custom",
        }),
      }),
    );
  });

  it("defaults toolChoice to auto when tools are provided and omits internal context from client payload", async () => {
    const provider = createProvider();
    client.createCompletion.mockResolvedValueOnce(makeResponse());
    const tools = [
      {
        type: "function",
        function: {
          name: "route_conversation",
        },
      },
    ] as AiCompletionRequestOptions["tools"];

    await provider.createCompletion({
      messages: [{ role: "user", content: "hello" }],
      tools,
      maxTokens: 123,
      temperature: 0.4,
      context: { channel: "TEXT", lane: "TRIAGE_ROUTER" },
    });

    const payload = getFirstPayload();
    expect(payload.model).toBe("gpt-5.1-codex");
    expect(payload.toolChoice).toBe("auto");
    expect(payload.maxTokens).toBe(123);
    expect(payload.temperature).toBe(0.4);
    expect(payload.context).toBeUndefined();
    expect(payload.tools).toEqual(tools);
  });
});
