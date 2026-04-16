import type { WebSocket } from "ws";
import { VoiceStreamCallLifecycleRuntime } from "./voice-stream-call-lifecycle.runtime";
import { VoiceStreamSpeechRuntime } from "./voice-stream-speech.runtime";
import type { VoiceStreamSession } from "./voice-stream.types";

type VoiceStreamStopEvent = {
  callSid?: string;
  streamSid?: string;
};

export class VoiceStreamSessionRuntime {
  readonly sessions = new Map<WebSocket, VoiceStreamSession>();
  readonly callSessions = new Map<string, WebSocket>();

  constructor(
    private readonly speechRuntime: VoiceStreamSpeechRuntime,
    private readonly callLifecycleRuntime: VoiceStreamCallLifecycleRuntime,
  ) {}

  getSession(client: WebSocket): VoiceStreamSession | undefined {
    return this.sessions.get(client);
  }

  setSession(client: WebSocket, session: VoiceStreamSession): void {
    this.sessions.set(client, session);
    this.callSessions.set(session.callSid, client);
  }

  replaceExistingCallClient(
    callSid: string,
    incomingClient: WebSocket,
  ): WebSocket | null {
    const existingClient = this.callSessions.get(callSid);
    if (!existingClient || existingClient === incomingClient) {
      return null;
    }
    this.cleanupSession(existingClient);
    return existingClient;
  }

  handleDisconnect(client: WebSocket): void {
    const session = this.sessions.get(client);
    if (session) {
      this.callLifecycleRuntime.recordCallEnded({
        session,
        source: "disconnect",
      });
    }
    this.cleanupSession(client);
  }

  handleStop(client: WebSocket, stop: VoiceStreamStopEvent): void {
    const session = this.sessions.get(client);
    if (!session) {
      return;
    }
    this.callLifecycleRuntime.recordCallEnded({
      session,
      source: "stop",
      callSid: stop.callSid,
      streamSid: stop.streamSid,
    });
    this.cleanupSession(client);
  }

  handleFatalClient(client: WebSocket): void {
    this.cleanupSession(client);
    this.closeClient(client);
  }

  cleanupSession(client: WebSocket): void {
    const session = this.sessions.get(client);
    if (!session) {
      return;
    }
    session.closed = true;
    this.speechRuntime.closeSpeechStream(session.speechStream);
    if (this.callSessions.get(session.callSid) === client) {
      this.callSessions.delete(session.callSid);
    }
    this.sessions.delete(client);
  }

  closeClient(client: WebSocket): void {
    try {
      client.close();
    } catch {
      // Best effort socket close.
    }
  }
}
