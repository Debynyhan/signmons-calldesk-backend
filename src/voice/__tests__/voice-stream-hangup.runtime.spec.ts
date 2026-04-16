import { VoiceStreamHangupRuntime } from "../voice-stream-hangup.runtime";

describe("VoiceStreamHangupRuntime", () => {
  let voiceCallService: {
    completeCall: jest.Mock;
  };
  let loggingService: {
    log: jest.Mock;
    warn: jest.Mock;
  };

  beforeEach(() => {
    voiceCallService = {
      completeCall: jest.fn().mockResolvedValue(true),
    };
    loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
    };
  });

  const buildRuntime = () =>
    new VoiceStreamHangupRuntime(
      voiceCallService as never,
      loggingService as never,
    );

  const buildSession = () => ({
    callSid: "CA123",
    streamSid: "MZ123",
    tenantId: "tenant-1",
    tenant: { id: "tenant-1" },
    streamUrl: "wss://example.ngrok.io/api/voice/stream",
    speechStream: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
    processing: false,
    startedAtMs: Date.now(),
    closed: false,
  });

  it("schedules and forces hangup after the minimum delay", async () => {
    jest.useFakeTimers();
    try {
      const runtime = buildRuntime();
      const session = buildSession();

      runtime.scheduleForcedHangupIfNeeded(
        session as never,
        "Thanks for calling goodbye",
      );

      expect(session.forceHangupScheduled).toBe(true);
      expect(session.forceHangupDelayMs).toBeGreaterThanOrEqual(12_000);
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "voice.stream.hangup_force_scheduled",
          callSid: "CA123",
          streamSid: "MZ123",
        }),
        "VoiceStreamGateway",
      );

      jest.advanceTimersByTime(11_999);
      await Promise.resolve();
      expect(voiceCallService.completeCall).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);

      expect(voiceCallService.completeCall).toHaveBeenCalledWith("CA123");
      expect(session.forceHangupScheduled).toBe(false);
      expect(session.forceHangupDelayMs).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not schedule when session is already closed or already scheduled", () => {
    const runtime = buildRuntime();
    const closedSession = {
      ...buildSession(),
      closed: true,
    };
    runtime.scheduleForcedHangupIfNeeded(closedSession as never, "goodbye");

    const alreadyScheduledSession = {
      ...buildSession(),
      forceHangupScheduled: true,
    };
    runtime.scheduleForcedHangupIfNeeded(
      alreadyScheduledSession as never,
      "goodbye",
    );

    expect(voiceCallService.completeCall).not.toHaveBeenCalled();
    expect(loggingService.log).not.toHaveBeenCalled();
  });

  it("logs warning and clears state when forced hangup fails", async () => {
    jest.useFakeTimers();
    try {
      voiceCallService.completeCall.mockRejectedValueOnce(new Error("timeout"));
      const runtime = buildRuntime();
      const session = buildSession();

      runtime.scheduleForcedHangupIfNeeded(session as never, "goodbye");
      await jest.advanceTimersByTimeAsync(12_000);

      expect(loggingService.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "voice.stream.hangup_force_result",
          callSid: "CA123",
          completed: false,
          reason: "timeout",
        }),
        "VoiceStreamGateway",
      );
      expect(session.forceHangupScheduled).toBe(false);
      expect(session.forceHangupDelayMs).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
