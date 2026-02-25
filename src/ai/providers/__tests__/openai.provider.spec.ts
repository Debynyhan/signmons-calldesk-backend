import { jest } from "@jest/globals";
import type OpenAI from "openai";
import { OpenAiProvider } from "../openai.provider";

describe("OpenAiProvider", () => {
  let createCompletionMock: jest.Mock;
  let provider: OpenAiProvider;

  beforeEach(() => {
    createCompletionMock = jest.fn();
    const client = {
      chat: {
        completions: {
          create: createCompletionMock,
        },
      },
    } as unknown as OpenAI;

    provider = new OpenAiProvider(client);
  });

  it("maps normalized request fields to the OpenAI request shape", async () => {
    createCompletionMock.mockResolvedValue({
      id: "resp-1",
      model: "gpt-4o-mini",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello",
            refusal: null,
          },
        },
      ],
    } as never);

    await provider.createCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 120,
      temperature: 0.35,
      tools: [
        {
          type: "function",
          function: {
            name: "route_conversation",
            description: "Route the conversation",
          },
        },
      ],
      toolChoice: "none",
      context: { channel: "TEXT", lane: "TRIAGE_ROUTER" },
    });

    const payload = createCompletionMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 120,
      temperature: 0.35,
      tool_choice: "none",
    });
    expect(payload.tools).toEqual([
      {
        type: "function",
        function: {
          name: "route_conversation",
          description: "Route the conversation",
        },
      },
    ]);
    expect(payload).not.toHaveProperty("maxTokens");
    expect(payload).not.toHaveProperty("toolChoice");
    expect(payload).not.toHaveProperty("context");
  });

  it("defaults tool_choice to auto when tools are provided without toolChoice", async () => {
    createCompletionMock.mockResolvedValue({
      id: "resp-2",
      model: "gpt-4o-mini",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello",
            refusal: null,
          },
        },
      ],
    } as never);

    await provider.createCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "create_job",
          },
        },
      ],
    });

    const payload = createCompletionMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.tool_choice).toBe("auto");
  });

  it("omits tool fields and optional numeric fields when not provided", async () => {
    createCompletionMock.mockResolvedValue({
      id: "resp-3",
      model: "gpt-4o-mini",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello",
          },
        },
      ],
    } as never);

    await provider.createCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });

    const payload = createCompletionMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("tools");
    expect(payload).not.toHaveProperty("tool_choice");
    expect(payload).not.toHaveProperty("max_tokens");
    expect(payload).not.toHaveProperty("temperature");
  });

  it("normalizes OpenAI response message content arrays, refusals, and tool calls", async () => {
    createCompletionMock.mockResolvedValue({
      id: "resp-4",
      model: "gpt-4o-mini",
      choices: [
        {
          message: {
            role: "assistant",
            content: ["prefix ", { type: "text", text: "hello" }],
            refusal: "policy_violation",
            tool_calls: [
              {
                id: "tool-call-1",
                type: "function",
                function: {
                  name: "route_conversation",
                  arguments: "{\"intent\":\"BOOKING\"}",
                },
              },
            ],
          },
        },
      ],
    } as never);

    const response = await provider.createCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response).toEqual({
      id: "resp-4",
      model: "gpt-4o-mini",
      choices: [
        {
          message: {
            role: "assistant",
            content: ["prefix ", { text: "hello" }],
            refusal: "policy_violation",
            tool_calls: [
              {
                id: "tool-call-1",
                type: "function",
                function: {
                  name: "route_conversation",
                  arguments: "{\"intent\":\"BOOKING\"}",
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("normalizes missing refusal to null and omits tool_calls when absent", async () => {
    createCompletionMock.mockResolvedValue({
      id: "resp-5",
      model: "gpt-4o-mini",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Plain text reply",
            refusal: undefined,
          },
        },
      ],
    } as never);

    const response = await provider.createCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.choices[0]?.message).toEqual({
      role: "assistant",
      content: "Plain text reply",
      refusal: null,
    });
  });
});
