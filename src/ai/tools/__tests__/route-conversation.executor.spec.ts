import { BadRequestException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { RouteConversationToolExecutor } from "../route-conversation.executor";
import { ConversationsService } from "../../../conversations/conversations.service";

describe("RouteConversationToolExecutor", () => {
  let conversationsService: jest.Mocked<ConversationsService>;
  let executor: RouteConversationToolExecutor;

  beforeEach(() => {
    conversationsService = {
      setAiRouteIntent: jest.fn(),
    } as unknown as jest.Mocked<ConversationsService>;
    executor = new RouteConversationToolExecutor(
      conversationsService as unknown as ConversationsService,
    );
  });

  it("persists route intent and returns continue", async () => {
    conversationsService.setAiRouteIntent.mockResolvedValue({
      id: "conversation-1",
      collectedData: { aiRoute: { intent: "BOOKING" } },
    } as never);

    const result = await executor.execute({
      tenantId: "tenant-1",
      sessionId: "session-1",
      conversationId: "conversation-1",
      rawArgs: JSON.stringify({ intent: "BOOKING" }),
    });

    expect(result).toEqual({ status: "continue", intent: "BOOKING" });
    expect(conversationsService.setAiRouteIntent).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      intent: "BOOKING",
    });
  });

  it("blocks repeated route calls in the same turn before persisting", async () => {
    await expect(
      executor.execute({
        tenantId: "tenant-1",
        sessionId: "session-1",
        conversationId: "conversation-1",
        routeContinuationCount: 1,
        rawArgs: JSON.stringify({ intent: "FAQ" }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(conversationsService.setAiRouteIntent).not.toHaveBeenCalled();
  });

  it("rejects malformed tool args", async () => {
    await expect(
      executor.execute({
        tenantId: "tenant-1",
        sessionId: "session-1",
        conversationId: "conversation-1",
        rawArgs: "{bad-json}",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects invalid route intents", async () => {
    await expect(
      executor.execute({
        tenantId: "tenant-1",
        sessionId: "session-1",
        conversationId: "conversation-1",
        rawArgs: JSON.stringify({ intent: "SALES" }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when the conversation is missing", async () => {
    conversationsService.setAiRouteIntent.mockResolvedValue(null as never);

    await expect(
      executor.execute({
        tenantId: "tenant-1",
        sessionId: "session-1",
        conversationId: "conversation-1",
        rawArgs: JSON.stringify({ intent: "FAQ" }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
