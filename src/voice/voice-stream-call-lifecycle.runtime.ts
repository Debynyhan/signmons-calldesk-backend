import type { IConversationLifecycleService } from "../conversations/conversation-lifecycle.service.interface";
import { LoggingService } from "../logging/logging.service";
import type { VoiceStreamSession } from "./voice-stream.types";

type CallEndSource = "stop" | "disconnect";

type RecordCallEndedParams = {
  session: VoiceStreamSession;
  source: CallEndSource;
  callSid?: string;
  streamSid?: string;
};

export class VoiceStreamCallLifecycleRuntime {
  private static readonly LOG_SOURCE = "VoiceStreamGateway";

  constructor(
    private readonly conversationLifecycleService: IConversationLifecycleService,
    private readonly loggingService: LoggingService,
  ) {}

  recordCallEnded(params: RecordCallEndedParams): void {
    const { session, source } = params;
    const endedAt = new Date();
    const callEndedAt = endedAt.toISOString();
    const hangupRequestedAt = session.hangupRequestedAtMs
      ? new Date(session.hangupRequestedAtMs).toISOString()
      : null;
    const hangupToEndMs = session.hangupRequestedAtMs
      ? Math.max(0, Date.now() - session.hangupRequestedAtMs)
      : null;
    this.loggingService.log(
      {
        event: "voice.stream.call_ended",
        callSid: params.callSid ?? session.callSid,
        streamSid: params.streamSid ?? session.streamSid,
        call_ended_at: callEndedAt,
        hangup_requested_at: hangupRequestedAt,
        hangup_to_end_ms: hangupToEndMs,
        source,
      },
      VoiceStreamCallLifecycleRuntime.LOG_SOURCE,
    );

    void this.conversationLifecycleService
      .completeVoiceConversationByCallSid({
        tenantId: session.tenantId,
        callSid: session.callSid,
        source,
        endedAt,
        hangupRequestedAt,
        hangupToEndMs,
      })
      .catch((error: unknown) => {
        this.loggingService.warn(
          {
            event: "voice.stream.call_end_persist_failed",
            callSid: session.callSid,
            streamSid: session.streamSid,
            source,
            reason: error instanceof Error ? error.message : String(error),
          },
          VoiceStreamCallLifecycleRuntime.LOG_SOURCE,
        );
      });
  }
}
