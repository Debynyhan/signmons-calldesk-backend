import { VoiceCallStateService } from "../voice-call-state.service";

describe("VoiceCallStateService", () => {
  describe("shouldSuppressDuplicateResponse", () => {
    it("returns false for first response", () => {
      const svc = new VoiceCallStateService();
      expect(svc.shouldSuppressDuplicateResponse("CA123", "<Response/>")).toBe(false);
    });

    it("returns true for identical response within 2 seconds", () => {
      const svc = new VoiceCallStateService();
      svc.shouldSuppressDuplicateResponse("CA123", "<Response/>");
      expect(svc.shouldSuppressDuplicateResponse("CA123", "<Response/>")).toBe(true);
    });

    it("returns false for different twiml on same callSid", () => {
      const svc = new VoiceCallStateService();
      svc.shouldSuppressDuplicateResponse("CA123", "<Response><Say>Hello</Say></Response>");
      expect(
        svc.shouldSuppressDuplicateResponse("CA123", "<Response><Say>Goodbye</Say></Response>"),
      ).toBe(false);
    });

    it("returns false for different callSids with same twiml", () => {
      const svc = new VoiceCallStateService();
      svc.shouldSuppressDuplicateResponse("CA111", "<Response/>");
      expect(svc.shouldSuppressDuplicateResponse("CA222", "<Response/>")).toBe(false);
    });

    it("returns false after 2 seconds have elapsed", () => {
      jest.useFakeTimers();
      const svc = new VoiceCallStateService();
      svc.shouldSuppressDuplicateResponse("CA123", "<Response/>");
      jest.advanceTimersByTime(2001);
      expect(svc.shouldSuppressDuplicateResponse("CA123", "<Response/>")).toBe(false);
      jest.useRealTimers();
    });
  });

  describe("issue prompt attempt tracking", () => {
    it("returns 0 for unknown callSid", () => {
      const svc = new VoiceCallStateService();
      expect(svc.getIssuePromptAttempts("CA999")).toBe(0);
    });

    it("stores and retrieves attempt count", () => {
      const svc = new VoiceCallStateService();
      svc.setIssuePromptAttempts("CA123", 3);
      expect(svc.getIssuePromptAttempts("CA123")).toBe(3);
    });

    it("clearIssuePromptAttempts resets to 0", () => {
      const svc = new VoiceCallStateService();
      svc.setIssuePromptAttempts("CA123", 2);
      svc.clearIssuePromptAttempts("CA123");
      expect(svc.getIssuePromptAttempts("CA123")).toBe(0);
    });

    it("clearIssuePromptAttempts is a no-op for undefined", () => {
      const svc = new VoiceCallStateService();
      expect(() => svc.clearIssuePromptAttempts(undefined)).not.toThrow();
    });

    it("tracks attempts independently per callSid", () => {
      const svc = new VoiceCallStateService();
      svc.setIssuePromptAttempts("CA111", 1);
      svc.setIssuePromptAttempts("CA222", 5);
      expect(svc.getIssuePromptAttempts("CA111")).toBe(1);
      expect(svc.getIssuePromptAttempts("CA222")).toBe(5);
    });
  });
});
