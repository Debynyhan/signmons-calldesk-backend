import { BadRequestException } from "@nestjs/common";
import { CommunicationChannel } from "@prisma/client";
import { AiService } from "../ai.service";
import type { AiErrorHandler } from "../ai-error.handler";
import type { AiExtractionService } from "../ai-extraction.service";
import type { TriageContextBuilderService } from "../triage-context-builder.service";
import type { TriageContext } from "../triage-context-builder.service";
import type { TriageOrchestratorService } from "../triage-orchestrator.service";
import type { SanitizationService } from "../../sanitization/sanitization.service";

describe("AiService", () => {
  let errorHandler: jest.Mocked<AiErrorHandler>;
  let sanitizationService: jest.Mocked<SanitizationService>;
  let aiExtractionService: jest.Mocked<AiExtractionService>;
  let triageOrchestrator: jest.Mocked<TriageOrchestratorService>;
  let triageContextBuilder: jest.Mocked<TriageContextBuilderService>;
  let service: AiService;

  const context: TriageContext = {
    tenantId: "tenant-safe",
    sessionId: "session-safe",
    conversationId: "conversation-1",
    tenantContextPrompt: "You are Demo HVAC.",
    conversationHistory: [{ role: "user", content: "Previous turn" }],
    collectedData: { name: "Dean" },
  };

  beforeEach(() => {
    errorHandler = {
      handle: jest.fn(),
    } as unknown as jest.Mocked<AiErrorHandler>;
    sanitizationService = {
      sanitizeText: jest.fn(),
    } as unknown as jest.Mocked<SanitizationService>;
    aiExtractionService = {
      extractNameCandidate: jest.fn(),
      extractAddressCandidate: jest.fn(),
    } as unknown as jest.Mocked<AiExtractionService>;
    triageOrchestrator = {
      run: jest.fn(),
    } as unknown as jest.Mocked<TriageOrchestratorService>;
    triageContextBuilder = {
      build: jest.fn(),
    } as unknown as jest.Mocked<TriageContextBuilderService>;

    service = new AiService(
      errorHandler,
      sanitizationService,
      aiExtractionService,
      triageOrchestrator,
      triageContextBuilder,
    );
  });

  it("sanitizes input, builds context, and delegates to triage orchestrator", async () => {
    sanitizationService.sanitizeText.mockReturnValue("Need heat today");
    triageContextBuilder.build.mockResolvedValue(context);
    triageOrchestrator.run.mockResolvedValue({
      status: "reply",
      reply: "Thanks, we can help.",
    } as never);

    const result = await service.triage(
      "tenant-raw",
      "session-raw",
      " Need heat today ",
      {
        conversationId: "conversation-1",
        channel: CommunicationChannel.SMS,
      },
    );

    expect(triageContextBuilder.build).toHaveBeenCalledWith(
      "tenant-raw",
      "session-raw",
      {
        conversationId: "conversation-1",
        channel: CommunicationChannel.SMS,
      },
    );
    expect(triageOrchestrator.run).toHaveBeenCalledWith({
      ...context,
      userMessage: "Need heat today",
      originalUserMessage: " Need heat today ",
      incomingMessageLength: " Need heat today ".length,
      channel: CommunicationChannel.SMS,
    });
    expect(result).toEqual({
      status: "reply",
      reply: "Thanks, we can help.",
    });
    expect(errorHandler.handle).not.toHaveBeenCalled();
  });

  it("fails closed when sanitized message is empty", async () => {
    sanitizationService.sanitizeText.mockReturnValue("");

    const result = await service.triage(
      "tenant-raw",
      "session-raw",
      "   ",
      {
        channel: CommunicationChannel.VOICE,
      },
    );

    expect(result).toBeUndefined();
    expect(triageContextBuilder.build).not.toHaveBeenCalled();
    expect(triageOrchestrator.run).not.toHaveBeenCalled();
    expect(errorHandler.handle).toHaveBeenCalledWith(
      expect.any(BadRequestException),
      expect.objectContaining({
        tenantId: "tenant-raw",
        stage: "triage",
        messageLength: 3,
        metadata: { sessionId: "session-raw" },
      }),
    );
  });

  it("reports context-builder failures with raw tenant/session ids", async () => {
    const err = new Error("context failed");
    sanitizationService.sanitizeText.mockReturnValue("hello");
    triageContextBuilder.build.mockRejectedValue(err);

    const result = await service.triage("tenant-raw", "session-raw", "hello");

    expect(result).toBeUndefined();
    expect(errorHandler.handle).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        tenantId: "tenant-raw",
        stage: "triage",
        metadata: { sessionId: "session-raw" },
      }),
    );
  });

  it("propagates orchestrator failures after context build", async () => {
    const err = new Error("orchestrator failed");
    sanitizationService.sanitizeText.mockReturnValue("hello");
    triageContextBuilder.build.mockResolvedValue(context);
    triageOrchestrator.run.mockRejectedValue(err);

    await expect(
      service.triage("tenant-raw", "session-raw", "hello"),
    ).rejects.toThrow("orchestrator failed");
    expect(errorHandler.handle).not.toHaveBeenCalled();
    expect(triageContextBuilder.build).toHaveBeenCalledWith(
      "tenant-raw",
      "session-raw",
      undefined,
    );
  });

  it("delegates name extraction to aiExtractionService", async () => {
    aiExtractionService.extractNameCandidate.mockResolvedValue("Dean Banks");

    const candidate = await service.extractNameCandidate(
      "tenant-1",
      "my name is Dean",
    );

    expect(candidate).toBe("Dean Banks");
    expect(aiExtractionService.extractNameCandidate).toHaveBeenCalledWith(
      "tenant-1",
      "my name is Dean",
    );
  });

  it("delegates address extraction to aiExtractionService", async () => {
    aiExtractionService.extractAddressCandidate.mockResolvedValue({
      address: "20991 Recher Ave Euclid OH 44119",
      confidence: 0.92,
      houseNumber: "20991",
      street: "Recher Ave",
      city: "Euclid",
      state: "OH",
      zip: "44119",
    });

    const candidate = await service.extractAddressCandidate(
      "tenant-1",
      "my address is 20991 recher ave euclid ohio",
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        address: "20991 Recher Ave Euclid OH 44119",
        confidence: 0.92,
      }),
    );
    expect(aiExtractionService.extractAddressCandidate).toHaveBeenCalledWith(
      "tenant-1",
      "my address is 20991 recher ave euclid ohio",
    );
  });
});
