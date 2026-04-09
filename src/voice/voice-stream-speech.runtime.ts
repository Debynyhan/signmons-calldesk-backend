import { protos } from "@google-cloud/speech";
import type { WebSocket } from "ws";
import { GoogleSpeechService } from "../google/google-speech.service";
import { LoggingService } from "../logging/logging.service";
import type { VoiceStreamSession } from "./voice-stream.types";

type SpeechStreamHandlers = {
  onData: (
    session: VoiceStreamSession,
    data: protos.google.cloud.speech.v1.IStreamingRecognizeResponse,
  ) => void;
  onFatal: (client: WebSocket, session: VoiceStreamSession) => void;
};

export class VoiceStreamSpeechRuntime {
  private static readonly LOG_SOURCE = "VoiceStreamGateway";
  private static readonly SPEECH_STREAM_RESTART_MAX = 3;
  private static readonly SPEECH_STREAM_RESTART_WINDOW_MS = 60_000;

  constructor(
    private readonly googleSpeechService: GoogleSpeechService,
    private readonly loggingService: LoggingService,
  ) {}

  attachSpeechStreamHandlers(
    client: WebSocket,
    session: VoiceStreamSession,
    speechStream: NodeJS.ReadWriteStream,
    handlers: SpeechStreamHandlers,
  ): void {
    speechStream.on("data", (data) => {
      handlers.onData(
        session,
        data as protos.google.cloud.speech.v1.IStreamingRecognizeResponse,
      );
    });
    speechStream.on("error", (error) => {
      void this.handleSpeechStreamError(client, session, error, handlers);
    });
  }

  isWritableStream(stream: NodeJS.ReadWriteStream): boolean {
    const writable = (stream as NodeJS.WritableStream).writable;
    const writableOk = typeof writable === "boolean" ? writable : true;
    const writableEndedValue = (stream as { writableEnded?: unknown })
      .writableEnded;
    const writableEnded =
      typeof writableEndedValue === "boolean" ? writableEndedValue : false;
    const destroyedValue = (stream as { destroyed?: unknown }).destroyed;
    const destroyed =
      typeof destroyedValue === "boolean" ? destroyedValue : false;
    return writableOk && !writableEnded && !destroyed;
  }

  closeSpeechStream(stream: NodeJS.ReadWriteStream): void {
    stream.removeAllListeners("data");
    stream.removeAllListeners("error");
    // Keep a terminal error handler so late stream errors cannot crash Node.
    stream.on("error", () => undefined);
    try {
      stream.end();
    } catch {
      // Stream may already be ended/destroyed.
    }
  }

  private async handleSpeechStreamError(
    client: WebSocket,
    session: VoiceStreamSession,
    error: unknown,
    handlers: SpeechStreamHandlers,
  ): Promise<void> {
    if (session.closed) {
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (this.isRecoverableSpeechStreamError(error)) {
      const restarted = this.tryRestartSpeechStream(
        client,
        session,
        reason,
        handlers,
      );
      if (restarted) {
        return;
      }
    }
    this.loggingService.warn(
      {
        event: "voice.stream.speech_error",
        callSid: session.callSid,
        streamSid: session.streamSid,
        reason,
      },
      VoiceStreamSpeechRuntime.LOG_SOURCE,
    );
    handlers.onFatal(client, session);
  }

  private isRecoverableSpeechStreamError(error: unknown): boolean {
    const codeValue = (error as { code?: unknown })?.code;
    const code = typeof codeValue === "number" ? codeValue : null;
    const detailsValue = (error as { details?: unknown })?.details;
    const details = typeof detailsValue === "string" ? detailsValue : "";
    const message = error instanceof Error ? error.message : String(error);
    const combined = `${details} ${message}`.toLowerCase();
    if (code === 4 || code === 14) {
      return true;
    }
    if (combined.includes("408:request timeout")) {
      return true;
    }
    if (code === 2 && (combined.includes("408") || combined.includes("timeout"))) {
      return true;
    }
    return false;
  }

  private tryRestartSpeechStream(
    client: WebSocket,
    session: VoiceStreamSession,
    reason: string,
    handlers: SpeechStreamHandlers,
  ): boolean {
    if (session.closed) {
      return false;
    }
    if (session.restartingSpeechStream) {
      return true;
    }
    const nowMs = Date.now();
    if (
      !session.lastSpeechRestartAtMs ||
      nowMs - session.lastSpeechRestartAtMs >
        VoiceStreamSpeechRuntime.SPEECH_STREAM_RESTART_WINDOW_MS
    ) {
      session.speechRestartCount = 0;
    }
    if (
      session.speechRestartCount >=
      VoiceStreamSpeechRuntime.SPEECH_STREAM_RESTART_MAX
    ) {
      this.loggingService.warn(
        {
          event: "voice.stream.speech_restart_exhausted",
          callSid: session.callSid,
          streamSid: session.streamSid,
          restartCount: session.speechRestartCount,
          reason,
        },
        VoiceStreamSpeechRuntime.LOG_SOURCE,
      );
      return false;
    }

    session.restartingSpeechStream = true;
    try {
      const nextSpeechStream =
        this.googleSpeechService.createStreamingRecognizeStream();
      if (!nextSpeechStream) {
        this.loggingService.warn(
          {
            event: "voice.stream.speech_restart_failed",
            callSid: session.callSid,
            streamSid: session.streamSid,
            reason,
          },
          VoiceStreamSpeechRuntime.LOG_SOURCE,
        );
        return false;
      }
      this.closeSpeechStream(session.speechStream);
      session.speechStream = nextSpeechStream;
      session.speechRestartCount += 1;
      session.lastSpeechRestartAtMs = nowMs;
      this.attachSpeechStreamHandlers(client, session, nextSpeechStream, handlers);
      this.loggingService.log(
        {
          event: "voice.stream.speech_restarted",
          callSid: session.callSid,
          streamSid: session.streamSid,
          restartCount: session.speechRestartCount,
          reason,
        },
        VoiceStreamSpeechRuntime.LOG_SOURCE,
      );
      return true;
    } finally {
      session.restartingSpeechStream = false;
    }
  }
}
