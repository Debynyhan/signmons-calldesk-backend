import { LoggingService } from "../logging/logging.service";
import { VoiceCallService } from "./voice-call.service";
import type { VoiceStreamSession } from "./voice-stream.types";

export class VoiceStreamHangupRuntime {
  private static readonly LOG_SOURCE = "VoiceStreamGateway";
  private static readonly HANGUP_FORCE_CLOSE_MIN_DELAY_MS = 12_000;
  private static readonly HANGUP_FORCE_CLOSE_MAX_DELAY_MS = 30_000;
  private static readonly HANGUP_FORCE_CLOSE_BUFFER_MS = 3_000;

  constructor(
    private readonly voiceCallService: VoiceCallService,
    private readonly loggingService: LoggingService,
  ) {}

  scheduleForcedHangupIfNeeded(
    session: VoiceStreamSession,
    closingText: string,
  ): void {
    if (session.closed || session.forceHangupScheduled) {
      return;
    }
    session.forceHangupScheduled = true;
    const delayMs = this.estimateHangupForceDelayMs(closingText);
    session.forceHangupDelayMs = delayMs;
    this.loggingService.log(
      {
        event: "voice.stream.hangup_force_scheduled",
        callSid: session.callSid,
        streamSid: session.streamSid,
        hangup_requested_at: session.hangupRequestedAtMs
          ? new Date(session.hangupRequestedAtMs).toISOString()
          : null,
        force_delay_ms: delayMs,
      },
      VoiceStreamHangupRuntime.LOG_SOURCE,
    );

    const timer = setTimeout(() => {
      if (session.closed) {
        return;
      }
      const now = Date.now();
      const hangupRequestedAt = session.hangupRequestedAtMs ?? now;
      const elapsedMs = Math.max(0, now - hangupRequestedAt);
      void this.voiceCallService
        .completeCall(session.callSid)
        .then((completed) => {
          this.loggingService.log(
            {
              event: "voice.stream.hangup_force_result",
              callSid: session.callSid,
              streamSid: session.streamSid,
              completed,
              hangup_requested_at: new Date(hangupRequestedAt).toISOString(),
              force_attempted_at: new Date(now).toISOString(),
              hangup_to_force_attempt_ms: elapsedMs,
              force_delay_ms: delayMs,
            },
            VoiceStreamHangupRuntime.LOG_SOURCE,
          );
        })
        .catch((error: unknown) => {
          this.loggingService.warn(
            {
              event: "voice.stream.hangup_force_result",
              callSid: session.callSid,
              streamSid: session.streamSid,
              completed: false,
              reason: error instanceof Error ? error.message : String(error),
              hangup_requested_at: new Date(hangupRequestedAt).toISOString(),
              force_attempted_at: new Date(now).toISOString(),
              hangup_to_force_attempt_ms: elapsedMs,
              force_delay_ms: delayMs,
            },
            VoiceStreamHangupRuntime.LOG_SOURCE,
          );
        })
        .finally(() => {
          session.forceHangupScheduled = false;
          session.forceHangupDelayMs = undefined;
        });
    }, delayMs);

    if (typeof (timer as NodeJS.Timeout).unref === "function") {
      (timer as NodeJS.Timeout).unref();
    }
  }

  private estimateHangupForceDelayMs(text: string): number {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return VoiceStreamHangupRuntime.HANGUP_FORCE_CLOSE_MIN_DELAY_MS;
    }
    const wordCount = normalized.split(" ").filter(Boolean).length;
    const speechMs = Math.round((wordCount / 2.4) * 1000);
    const withBuffer =
      speechMs + VoiceStreamHangupRuntime.HANGUP_FORCE_CLOSE_BUFFER_MS;
    return Math.min(
      VoiceStreamHangupRuntime.HANGUP_FORCE_CLOSE_MAX_DELAY_MS,
      Math.max(VoiceStreamHangupRuntime.HANGUP_FORCE_CLOSE_MIN_DELAY_MS, withBuffer),
    );
  }
}
