import { Inject } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from "@nestjs/websockets";
import { protos } from "@google-cloud/speech";
import type { RawData, WebSocket } from "ws";
import appConfig, { type AppConfig } from "../config/app.config";
import { LoggingService } from "../logging/logging.service";
import { VOICE_STREAM_PATH } from "./voice-streaming.utils";
import { VoiceStreamCallLifecycleRuntime } from "./voice-stream-call-lifecycle.runtime";
import { VoiceStreamSpeechRuntime } from "./voice-stream-speech.runtime";
import { VoiceStreamStartRuntime } from "./voice-stream-start.runtime";
import { VoiceStreamTurnExecutionRuntime } from "./voice-stream-turn-execution.runtime";
import { VoiceStreamTurnRuntime } from "./voice-stream-turn.runtime";
import {
  VoiceStreamTransportRuntime,
  type TwilioStreamMedia,
  type TwilioStreamStart,
  type TwilioStreamStop,
} from "./voice-stream-transport.runtime";
import type { VoiceStreamSession } from "./voice-stream.types";
import { VoiceStreamDependencies } from "./voice-stream.dependencies";
import { VoiceStreamSessionRuntime } from "./voice-stream-session.runtime";

@WebSocketGateway({ path: VOICE_STREAM_PATH })
export class VoiceStreamGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly callLifecycleRuntime: VoiceStreamCallLifecycleRuntime;
  private readonly sessionRuntime: VoiceStreamSessionRuntime;
  private readonly speechRuntime: VoiceStreamSpeechRuntime;
  private readonly startRuntime: VoiceStreamStartRuntime;
  private readonly turnExecutionRuntime: VoiceStreamTurnExecutionRuntime;
  private readonly turnRuntime: VoiceStreamTurnRuntime;
  private readonly transportRuntime: VoiceStreamTransportRuntime;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly dependencies: VoiceStreamDependencies,
    private readonly loggingService: LoggingService,
  ) {
    this.callLifecycleRuntime = new VoiceStreamCallLifecycleRuntime(
      this.conversationLifecycleService,
      this.loggingService,
    );
    this.speechRuntime = new VoiceStreamSpeechRuntime(
      this.googleSpeechService,
      this.loggingService,
    );
    this.sessionRuntime = new VoiceStreamSessionRuntime(
      this.speechRuntime,
      this.callLifecycleRuntime,
    );
    this.startRuntime = new VoiceStreamStartRuntime(
      this.config,
      this.tenantsService,
      this.conversationLifecycleService,
      this.googleSpeechService,
      this.loggingService,
    );
    this.turnRuntime = new VoiceStreamTurnRuntime(
      this.config,
      this.googleTtsService,
      this.voiceCallService,
      this.loggingService,
    );
    this.turnExecutionRuntime = new VoiceStreamTurnExecutionRuntime(
      this.config,
      this.voiceConversationStateService,
      this.voiceCallService,
      this.voiceTurnService,
      this.voiceFillerAudioService,
      this.loggingService,
      {
        isFillerTranscript: (transcript) => this.isFillerTranscript(transcript),
        buildNoSayFallbackText: (transcript) =>
          this.buildNoSayFallbackText(transcript),
        normalizeTranscriptForDeduplication: (value) =>
          this.normalizeTranscriptForDeduplication(value),
        scheduleForcedHangupIfNeeded: (session, closingText) =>
          this.scheduleForcedHangupIfNeeded(session, closingText),
        shouldUseGoogleTtsForText: (text, options) =>
          this.shouldUseGoogleTtsForText(text, options),
        computeTotalTurnMs: (params) => this.computeTotalTurnMs(params),
        getTurnLatencyBreaches: (params) => this.getTurnLatencyBreaches(params),
        getGoogleTtsPlayback: async (text) => this.getGoogleTtsPlayback(text),
      },
    );
    this.transportRuntime = new VoiceStreamTransportRuntime(
      this.loggingService,
    );
  }

  private get sessions() {
    return this.sessionRuntime.sessions;
  }

  private get callSessions() {
    return this.sessionRuntime.callSessions;
  }

  private get tenantsService() {
    return this.dependencies.tenantsService;
  }

  private get conversationLifecycleService() {
    return this.dependencies.conversationLifecycleService;
  }

  private get voiceConversationStateService() {
    return this.dependencies.voiceConversationStateService;
  }

  private get googleSpeechService() {
    return this.dependencies.googleSpeechService;
  }

  private get googleTtsService() {
    return this.dependencies.googleTtsService;
  }

  private get voiceCallService() {
    return this.dependencies.voiceCallService;
  }

  private get voiceTurnService() {
    return this.dependencies.voiceTurnService;
  }

  private get voiceFillerAudioService() {
    return this.dependencies.voiceFillerAudioService;
  }

  handleConnection(client: WebSocket) {
    client.on("message", (data: RawData) => {
      void this.handleMessage(client, data);
    });
  }

  handleDisconnect(client: WebSocket) {
    this.sessionRuntime.handleDisconnect(client);
  }

  private async handleMessage(client: WebSocket, data: RawData) {
    const message = this.transportRuntime.parseMessage(data);
    if (!message) {
      return;
    }
    switch (message.event) {
      case "start":
        await this.handleStart(client, message);
        return;
      case "media":
        this.handleMedia(client, message);
        return;
      case "stop":
        this.handleStop(client, message);
        return;
      default:
        return;
    }
  }

  private async handleStart(client: WebSocket, message: TwilioStreamStart) {
    if (!this.config.voiceStreamingEnabled) {
      client.close();
      return;
    }

    const callSid = message.start.callSid;
    const streamSid = message.start.streamSid;
    if (!callSid || !streamSid) {
      client.close();
      return;
    }
    const existingClient = this.sessionRuntime.replaceExistingCallClient(
      callSid,
      client,
    );
    if (existingClient) {
      this.sessionRuntime.closeClient(existingClient);
    }

    const session = await this.startRuntime.prepareStartSession({
      callSid,
      streamSid,
      customParameters: message.start.customParameters,
    });
    if (!session) {
      client.close();
      return;
    }

    this.sessionRuntime.setSession(client, session);
    this.loggingService.log(
      {
        event: "voice.stream.started",
        callSid,
        streamSid,
        tenantId: session.tenantId,
        streamUrl: session.streamUrl,
      },
      VoiceStreamGateway.name,
    );

    this.attachSpeechStreamHandlers(client, session, session.speechStream);
  }

  private handleMedia(client: WebSocket, message: TwilioStreamMedia) {
    const session = this.sessionRuntime.getSession(client);
    if (!session) {
      return;
    }
    if (
      session.closed ||
      !this.speechRuntime.isWritableStream(session.speechStream)
    ) {
      return;
    }
    const payload = message.media.payload;
    if (!payload) {
      return;
    }
    session.lastMediaAtMs = Date.now();
    const chunk = Buffer.from(payload, "base64");
    session.speechStream.write(chunk);
  }

  private handleStop(client: WebSocket, message: TwilioStreamStop) {
    this.sessionRuntime.handleStop(client, {
      callSid: message.stop.callSid,
      streamSid: message.stop.streamSid,
    });
  }

  private attachSpeechStreamHandlers(
    client: WebSocket,
    session: VoiceStreamSession,
    speechStream: NodeJS.ReadWriteStream,
  ) {
    this.speechRuntime.attachSpeechStreamHandlers(
      client,
      session,
      speechStream,
      {
        onData: (activeSession, data) => {
          this.handleSpeechData(activeSession, data);
        },
        onFatal: (fatalClient) => {
          this.sessionRuntime.handleFatalClient(fatalClient);
        },
      },
    );
  }

  private handleSpeechData(
    session: VoiceStreamSession,
    data: protos.google.cloud.speech.v1.IStreamingRecognizeResponse,
  ) {
    this.turnExecutionRuntime.handleSpeechData(session, data);
  }

  private async handleFinalTranscript(
    session: VoiceStreamSession,
    transcript: string,
    confidence?: number,
    sttFinalMs?: number,
    queuedAtMs?: number,
  ) {
    await this.turnExecutionRuntime.handleFinalTranscript(
      session,
      transcript,
      confidence,
      sttFinalMs,
      queuedAtMs,
    );
  }

  private isFillerTranscript(transcript: string): boolean {
    return this.turnRuntime.isFillerTranscript(transcript);
  }

  private buildNoSayFallbackText(transcript: string): string {
    return this.turnRuntime.buildNoSayFallbackText(transcript);
  }

  private normalizeTranscriptForDeduplication(value: string): string {
    return this.turnRuntime.normalizeTranscriptForDeduplication(value);
  }

  private cleanupSession(client: WebSocket) {
    this.sessionRuntime.cleanupSession(client);
  }

  private scheduleForcedHangupIfNeeded(
    session: VoiceStreamSession,
    closingText: string,
  ): void {
    this.turnRuntime.scheduleForcedHangupIfNeeded(session, closingText);
  }

  private shouldUseGoogleTts(): boolean {
    return this.turnRuntime.shouldUseGoogleTts();
  }

  private shouldUseGoogleTtsForText(
    text: string,
    options?: { hangup?: boolean },
  ): boolean {
    return this.turnRuntime.shouldUseGoogleTtsForText(text, options);
  }

  private shouldPreferTwilioSayForLatency(normalizedText: string): boolean {
    return this.turnRuntime.shouldPreferTwilioSayForLatency(normalizedText);
  }

  private computeTotalTurnMs(params: {
    sttFinalMs: number | null;
    queueDelayMs: number | null;
    turnLogicMs: number;
    ttsMs: number;
    twilioUpdateMs: number;
  }): number {
    return this.turnRuntime.computeTotalTurnMs(params);
  }

  private getTurnLatencyBreaches(params: {
    sttFinalMs: number | null;
    aiMs: number;
    ttsMs: number;
    twilioUpdateMs: number;
    totalTurnMs: number;
    isFirstResponse: boolean;
  }): string[] {
    return this.turnRuntime.getTurnLatencyBreaches(params);
  }

  private async getGoogleTtsPlayback(text: string): Promise<{
    playback: { url: string; objectPath: string };
    cacheHit: boolean;
  } | null> {
    return this.turnRuntime.getGoogleTtsPlayback(text);
  }
}
