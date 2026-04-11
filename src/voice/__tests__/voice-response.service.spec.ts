import type { Response } from "express";
import { VoiceResponseService } from "../voice-response.service";

jest.mock("../../common/context/request-context", () => ({
  getRequestContext: jest.fn(),
}));

import { getRequestContext } from "../../common/context/request-context";

const mockGetRequestContext = getRequestContext as jest.MockedFunction<
  typeof getRequestContext
>;

const buildCallLogService = () => ({
  createVoiceAssistantLog: jest.fn().mockResolvedValue(undefined),
});

const buildLoggingService = () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const buildVoicePromptComposer = () => ({
  extractSayMessages: jest.fn().mockReturnValue([]),
  buildClosingTwiml: jest
    .fn()
    .mockImplementation(
      (displayName: string, message: string) =>
        `<Response><Say>${displayName ? `${displayName} — ` : ""}${message}</Say><Hangup/></Response>`,
    ),
  unroutableTwiml: jest
    .fn()
    .mockReturnValue(
      "<Response><Say>We are unable to handle your call.</Say><Hangup/></Response>",
    ),
});

const buildVoiceCallStateService = () => {
  const map = new Map<string, number>();
  const respMap = new Map<string, { twiml: string; at: number }>();
  return {
    shouldSuppressDuplicateResponse: jest.fn().mockImplementation(
      (callSid: string, twiml: string) => {
        const now = Date.now();
        const last = respMap.get(callSid);
        if (last && last.twiml === twiml && now - last.at < 2000) {
          return true;
        }
        respMap.set(callSid, { twiml, at: now });
        return false;
      },
    ),
    getIssuePromptAttempts: jest.fn().mockImplementation(
      (callSid: string) => map.get(callSid) ?? 0,
    ),
    setIssuePromptAttempts: jest.fn().mockImplementation(
      (callSid: string, count: number) => map.set(callSid, count),
    ),
    clearIssuePromptAttempts: jest.fn().mockImplementation(
      (callSid: string | undefined) => { if (callSid) map.delete(callSid); },
    ),
  };
};

const buildService = (overrides: {
  callLogService?: ReturnType<typeof buildCallLogService>;
  loggingService?: ReturnType<typeof buildLoggingService>;
  voicePromptComposer?: ReturnType<typeof buildVoicePromptComposer>;
  voiceCallStateService?: ReturnType<typeof buildVoiceCallStateService>;
} = {}) =>
  new VoiceResponseService(
    (overrides.callLogService ?? buildCallLogService()) as never,
    (overrides.loggingService ?? buildLoggingService()) as never,
    (overrides.voicePromptComposer ?? buildVoicePromptComposer()) as never,
    (overrides.voiceCallStateService ?? buildVoiceCallStateService()) as never,
  );

const buildRes = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
};

describe("VoiceResponseService", () => {
  beforeEach(() => {
    mockGetRequestContext.mockReturnValue(null as never);
  });

  describe("replyWithTwiml", () => {
    it("sends twiml on the response and returns it", async () => {
      const service = buildService();
      const res = buildRes();
      const twiml = "<Response><Say>Hello</Say></Response>";

      const result = await service.replyWithTwiml(res, twiml);

      expect(result).toBe(twiml);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(twiml);
    });

    it("still returns twiml when res is undefined", async () => {
      const service = buildService();
      const twiml = "<Response><Say>Hello</Say></Response>";

      const result = await service.replyWithTwiml(undefined, twiml);

      expect(result).toBe(twiml);
    });

    it("suppresses duplicate responses within 2 seconds for same callSid", async () => {
      const callLogService = buildCallLogService();
      const voicePromptComposer = buildVoicePromptComposer();
      voicePromptComposer.extractSayMessages.mockReturnValue(["Hello"]);
      mockGetRequestContext.mockReturnValue({
        callSid: "CA123",
        channel: "VOICE",
        tenantId: "t1",
        conversationId: "c1",
        sourceEventId: "evt-1",
      } as never);

      const service = buildService({ callLogService, voicePromptComposer });
      const twiml = "<Response><Say>Hello</Say></Response>";

      await service.replyWithTwiml(undefined, twiml);
      await service.replyWithTwiml(undefined, twiml); // duplicate

      // createVoiceAssistantLog should only be called once
      expect(callLogService.createVoiceAssistantLog).toHaveBeenCalledTimes(1);
    });

    it("logs assistant messages when VOICE context is present", async () => {
      const callLogService = buildCallLogService();
      const voicePromptComposer = buildVoicePromptComposer();
      voicePromptComposer.extractSayMessages.mockReturnValue([
        "Hello",
        "How can I help?",
      ]);
      mockGetRequestContext.mockReturnValue({
        callSid: "CA123",
        channel: "VOICE",
        tenantId: "t1",
        conversationId: "c1",
        sourceEventId: "evt-1",
      } as never);

      const service = buildService({ callLogService, voicePromptComposer });
      await service.replyWithTwiml(
        undefined,
        "<Response><Say>Hello</Say><Say>How can I help?</Say></Response>",
      );

      expect(callLogService.createVoiceAssistantLog).toHaveBeenCalledTimes(2);
    });
  });

  describe("replyWithHumanFallback", () => {
    it("builds closing TwiML and logs the outcome", async () => {
      const loggingService = buildLoggingService();
      const voicePromptComposer = buildVoicePromptComposer();
      const service = buildService({ loggingService, voicePromptComposer });
      const res = buildRes();

      await service.replyWithHumanFallback({
        res,
        tenantId: "t1",
        conversationId: "c1",
        callSid: "CA123",
        displayName: "Acme HVAC",
        reason: "human_transfer",
      });

      expect(voicePromptComposer.buildClosingTwiml).toHaveBeenCalledWith(
        "Acme HVAC",
        "We'll follow up shortly.",
      );
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "voice.outcome",
          outcome: "human_fallback",
          reason: "human_transfer",
        }),
        VoiceResponseService.name,
      );
    });

    it("uses messageOverride when provided", async () => {
      const voicePromptComposer = buildVoicePromptComposer();
      const service = buildService({ voicePromptComposer });

      await service.replyWithHumanFallback({
        reason: "twilio_fallback",
        messageOverride: "We're having trouble. Please call back.",
      });

      expect(voicePromptComposer.buildClosingTwiml).toHaveBeenCalledWith(
        "",
        "We're having trouble. Please call back.",
      );
    });

    it("clears issue prompt attempts for the callSid", async () => {
      const service = buildService();
      service.setIssuePromptAttempts("CA123", 3);

      await service.replyWithHumanFallback({
        callSid: "CA123",
        reason: "hangup_request",
      });

      expect(service.getIssuePromptAttempts("CA123")).toBe(0);
    });
  });

  describe("replyWithNoHandoff", () => {
    it("uses unroutableTwiml by default and logs the outcome", async () => {
      const loggingService = buildLoggingService();
      const voicePromptComposer = buildVoicePromptComposer();
      const service = buildService({ loggingService, voicePromptComposer });

      await service.replyWithNoHandoff({ reason: "tenant_not_found" });

      expect(voicePromptComposer.unroutableTwiml).toHaveBeenCalled();
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "voice.outcome",
          outcome: "no_handoff",
          reason: "tenant_not_found",
        }),
        VoiceResponseService.name,
      );
    });

    it("uses twimlOverride when provided", async () => {
      const voicePromptComposer = buildVoicePromptComposer();
      const service = buildService({ voicePromptComposer });
      const res = buildRes();

      const override = "<Response><Say>Disabled.</Say><Hangup/></Response>";
      await service.replyWithNoHandoff({ res, reason: "voice_disabled", twimlOverride: override });

      expect(voicePromptComposer.unroutableTwiml).not.toHaveBeenCalled();
      expect(res.send).toHaveBeenCalledWith(override);
    });
  });

  describe("issue prompt attempt tracking", () => {
    it("tracks and clears attempts per callSid", () => {
      const service = buildService();

      expect(service.getIssuePromptAttempts("CA123")).toBe(0);
      service.setIssuePromptAttempts("CA123", 2);
      expect(service.getIssuePromptAttempts("CA123")).toBe(2);
      service.clearIssuePromptAttempts("CA123");
      expect(service.getIssuePromptAttempts("CA123")).toBe(0);
    });

    it("clearIssuePromptAttempts is a no-op for undefined callSid", () => {
      const service = buildService();
      expect(() => service.clearIssuePromptAttempts(undefined)).not.toThrow();
    });
  });
});
