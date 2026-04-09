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
import { GoogleSpeechService } from "../google/google-speech.service";
import { GoogleTtsService } from "../google/google-tts.service";
import { ConversationsService } from "../conversations/conversations.service";
import { VoiceCallService } from "./voice-call.service";
import { VoiceTurnService } from "./voice-turn.service";
import { VoiceFillerAudioService } from "./voice-filler-audio.service";
import {
  buildStreamingTwiml,
  extractSayMessages,
  hasHangup,
  VOICE_STREAM_PATH,
} from "./voice-streaming.utils";
import { runWithRequestContext } from "../common/context/request-context";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { VoiceStreamCallLifecycleRuntime } from "./voice-stream-call-lifecycle.runtime";
import { VoiceStreamSpeechRuntime } from "./voice-stream-speech.runtime";
import { VoiceStreamStartRuntime } from "./voice-stream-start.runtime";
import { VoiceStreamTurnRuntime } from "./voice-stream-turn.runtime";
import {
  VoiceStreamTransportRuntime,
  type TwilioStreamMedia,
  type TwilioStreamStart,
  type TwilioStreamStop,
} from "./voice-stream-transport.runtime";
import type { VoiceStreamSession } from "./voice-stream.types";

@WebSocketGateway({ path: VOICE_STREAM_PATH })
export class VoiceStreamGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly sessions = new Map<WebSocket, VoiceStreamSession>();
  private readonly callSessions = new Map<string, WebSocket>();
  private readonly callLifecycleRuntime: VoiceStreamCallLifecycleRuntime;
  private readonly speechRuntime: VoiceStreamSpeechRuntime;
  private readonly startRuntime: VoiceStreamStartRuntime;
  private readonly turnRuntime: VoiceStreamTurnRuntime;
  private readonly transportRuntime: VoiceStreamTransportRuntime;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    private readonly conversationsService: ConversationsService,
    private readonly googleSpeechService: GoogleSpeechService,
    private readonly googleTtsService: GoogleTtsService,
    private readonly voiceCallService: VoiceCallService,
    private readonly voiceTurnService: VoiceTurnService,
    private readonly voiceFillerAudioService: VoiceFillerAudioService,
    private readonly loggingService: LoggingService,
  ) {
    this.callLifecycleRuntime = new VoiceStreamCallLifecycleRuntime(
      this.conversationsService,
      this.loggingService,
    );
    this.speechRuntime = new VoiceStreamSpeechRuntime(
      this.googleSpeechService,
      this.loggingService,
    );
    this.startRuntime = new VoiceStreamStartRuntime(
      this.config,
      this.tenantsService,
      this.conversationsService,
      this.googleSpeechService,
      this.loggingService,
    );
    this.turnRuntime = new VoiceStreamTurnRuntime(
      this.config,
      this.googleTtsService,
      this.voiceCallService,
      this.loggingService,
    );
    this.transportRuntime = new VoiceStreamTransportRuntime(this.loggingService);
  }

  handleConnection(client: WebSocket) {
    client.on("message", (data: RawData) => {
      void this.handleMessage(client, data);
    });
  }

  handleDisconnect(client: WebSocket) {
    const session = this.sessions.get(client);
    if (session) {
      this.callLifecycleRuntime.recordCallEnded({
        session,
        source: "disconnect",
      });
    }
    this.cleanupSession(client);
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
    const existingClient = this.callSessions.get(callSid);
    if (existingClient && existingClient !== client) {
      this.cleanupSession(existingClient);
      try {
        existingClient.close();
      } catch {
        // Best effort cleanup.
      }
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

    this.sessions.set(client, session);
    this.callSessions.set(callSid, client);
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
    const session = this.sessions.get(client);
    if (!session) {
      return;
    }
    if (session.closed || !this.speechRuntime.isWritableStream(session.speechStream)) {
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
    const session = this.sessions.get(client);
    if (!session) {
      return;
    }
    this.callLifecycleRuntime.recordCallEnded({
      session,
      source: "stop",
      callSid: message.stop.callSid,
      streamSid: message.stop.streamSid,
    });
    this.cleanupSession(client);
  }

  private attachSpeechStreamHandlers(
    client: WebSocket,
    session: VoiceStreamSession,
    speechStream: NodeJS.ReadWriteStream,
  ) {
    this.speechRuntime.attachSpeechStreamHandlers(client, session, speechStream, {
      onData: (activeSession, data) => {
        this.handleSpeechData(activeSession, data);
      },
      onFatal: (fatalClient) => {
        this.cleanupSession(fatalClient);
        try {
          fatalClient.close();
        } catch {
          // Best effort socket close.
        }
      },
    });
  }

  private handleSpeechData(
    session: VoiceStreamSession,
    data: protos.google.cloud.speech.v1.IStreamingRecognizeResponse,
  ) {
    const result = data.results?.[0];
    const alternative = result?.alternatives?.[0];
    const transcript = alternative?.transcript?.trim();
    if (!transcript) {
      return;
    }
    if (!result?.isFinal) {
      return;
    }
    if (this.isFillerTranscript(transcript)) {
      return;
    }
    const normalizedTranscript =
      this.normalizeTranscriptForDeduplication(transcript);
    const now = Date.now();
    if (
      normalizedTranscript &&
      session.lastTranscript === normalizedTranscript &&
      session.lastTranscriptAt &&
      now - session.lastTranscriptAt < 3000
    ) {
      return;
    }
    session.lastTranscript = normalizedTranscript || transcript;
    session.lastTranscriptAt = now;
    const confidence = alternative?.confidence ?? undefined;
    const sttFinalMs = session.lastMediaAtMs
      ? Math.max(0, now - session.lastMediaAtMs)
      : Math.max(0, now - session.startedAtMs);
    void this.handleFinalTranscript(session, transcript, confidence, sttFinalMs);
  }

  private async handleFinalTranscript(
    session: VoiceStreamSession,
    transcript: string,
    confidence?: number,
    sttFinalMs?: number,
    queuedAtMs?: number,
  ) {
    if (session.processing) {
      session.pendingTranscript = {
        transcript,
        confidence,
        sttFinalMs,
        queuedAtMs: Date.now(),
      };
      return;
    }
    session.processing = true;

    // Fire a filler clip immediately to eliminate dead-air while AI processes.
    // Fire-and-forget: if it fails or no URL is ready, the call continues normally.
    const fillerUrl = this.voiceFillerAudioService.getFillerUrl();
    if (fillerUrl && !session.closed) {
      const fillerTwiml = buildStreamingTwiml({
        streamUrl: session.streamUrl,
        streamParams: { tenantId: session.tenantId, leadId: session.leadId },
        playUrl: fillerUrl,
        keepAliveSec: this.config.voiceStreamingKeepAliveSec,
        track: this.config.voiceStreamingTrack,
      });
      void this.voiceCallService.updateCallTwiml(session.callSid, fillerTwiml);
    }

    const queueDelayMs =
      typeof queuedAtMs === "number"
        ? Math.max(0, Date.now() - queuedAtMs)
        : null;
    const timingCollector = { aiMs: 0, aiCalls: 0 };
    const turnStartedAt = Date.now();
    let turnLogicMs = 0;
    let ttsMs = 0;
    let twilioUpdateMs = 0;
    const logTurnTiming = (params: {
      reason: string;
      twilioUpdated: boolean;
      usedGoogleTts?: boolean;
      ttsCacheHit?: boolean;
      ttsPolicy?: "google_play" | "twilio_say";
      hangup?: boolean;
      isFirstResponse?: boolean;
    }) => {
      const sttFinalMsValue =
        typeof sttFinalMs === "number" ? Math.max(0, sttFinalMs) : null;
      const queueDelayMsValue =
        typeof queueDelayMs === "number" ? Math.max(0, queueDelayMs) : null;
      const totalTurnMs = this.computeTotalTurnMs({
        sttFinalMs: sttFinalMsValue,
        queueDelayMs: queueDelayMsValue,
        turnLogicMs,
        ttsMs,
        twilioUpdateMs,
      });
      const latencyBreaches = this.getTurnLatencyBreaches({
        sttFinalMs: sttFinalMsValue,
        aiMs: timingCollector.aiMs,
        ttsMs,
        twilioUpdateMs,
        totalTurnMs,
        isFirstResponse: params.isFirstResponse ?? false,
      });
      this.loggingService.log(
        {
          event: "voice.stream.turn_timing",
          tenantId: session.tenantId,
          callSid: session.callSid,
          streamSid: session.streamSid,
          sttFinalMs: sttFinalMsValue,
          turnLogicMs,
          aiMs: timingCollector.aiMs,
          aiCalls: timingCollector.aiCalls,
          ttsMs,
          twilioUpdateMs,
          transcriptChars: transcript.length,
          queueDelayMs: queueDelayMsValue,
          reason: params.reason,
          twilioUpdated: params.twilioUpdated,
          usedGoogleTts: params.usedGoogleTts ?? false,
          ttsCacheHit: params.ttsCacheHit ?? false,
          ttsPolicy: params.ttsPolicy ?? "twilio_say",
          hangup: params.hangup ?? false,
          totalTurnMs,
          latencyBreaches,
        },
        VoiceStreamGateway.name,
      );
      if (latencyBreaches.length > 0) {
        this.loggingService.warn(
          {
            event: "voice.stream.turn_sla_warning",
            tenantId: session.tenantId,
            callSid: session.callSid,
            streamSid: session.streamSid,
            reason: params.reason,
            totalTurnMs,
            sttFinalMs: sttFinalMsValue,
            aiMs: timingCollector.aiMs,
            ttsMs,
            twilioUpdateMs,
            breaches: latencyBreaches,
            firstResponse: params.isFirstResponse ?? false,
          },
          VoiceStreamGateway.name,
        );
      }
      void this.conversationsService
        .appendVoiceTurnTiming({
          tenantId: session.tenantId,
          callSid: session.callSid,
          timing: {
            recordedAt: new Date().toISOString(),
            sttFinalMs: sttFinalMsValue,
            queueDelayMs: queueDelayMsValue,
            turnLogicMs,
            aiMs: timingCollector.aiMs,
            aiCalls: timingCollector.aiCalls,
            ttsMs,
            twilioUpdateMs,
            transcriptChars: transcript.length,
            reason: params.reason,
            twilioUpdated: params.twilioUpdated,
            usedGoogleTts: params.usedGoogleTts ?? false,
            ttsCacheHit: params.ttsCacheHit ?? false,
            ttsPolicy: params.ttsPolicy ?? "twilio_say",
            hangup: params.hangup ?? false,
            totalTurnMs,
            latencyBreaches,
          },
        })
        .catch((error: unknown) => {
          this.loggingService.warn(
            {
              event: "voice.stream.turn_timing_persist_failed",
              tenantId: session.tenantId,
              callSid: session.callSid,
              streamSid: session.streamSid,
              reason: error instanceof Error ? error.message : String(error),
            },
            VoiceStreamGateway.name,
          );
        });
    };
    try {
      const twiml = await runWithRequestContext(
        {
          tenantId: session.tenantId,
          callSid: session.callSid,
          channel: "VOICE",
          requestId: session.leadId,
        },
        () =>
          this.voiceTurnService.handleStreamingTurn({
            tenant: session.tenant,
            callSid: session.callSid,
            speechResult: transcript,
            confidence,
            requestId: session.leadId,
            timingCollector,
          }),
      );
      turnLogicMs = Math.max(0, Date.now() - turnStartedAt);

      const hangup = hasHangup(twiml);
      const messages = extractSayMessages(twiml);
      const hadNoSayMessages = messages.length === 0;
      const sayText = hadNoSayMessages
        ? this.buildNoSayFallbackText(transcript)
        : messages.join(" ");
      if (hadNoSayMessages) {
        this.loggingService.warn(
          {
            event: "voice.stream.no_say_fallback",
            tenantId: session.tenantId,
            callSid: session.callSid,
            streamSid: session.streamSid,
            transcriptChars: transcript.length,
            hangupRequested: hangup,
          },
          VoiceStreamGateway.name,
        );
      }
      if (hangup) {
        session.hangupRequestedAtMs = Date.now();
        this.loggingService.log(
          {
            event: "voice.stream.hangup_requested",
            tenantId: session.tenantId,
            callSid: session.callSid,
            streamSid: session.streamSid,
            hangup_requested_at: new Date(
              session.hangupRequestedAtMs,
            ).toISOString(),
          },
          VoiceStreamGateway.name,
        );
      }
      const useGoogleTts =
        !hadNoSayMessages &&
        this.shouldUseGoogleTtsForText(sayText, { hangup });
      let ttsCacheHit = false;
      let playUrlResult: { url: string; objectPath: string } | null = null;
      if (useGoogleTts) {
        const ttsStartedAt = Date.now();
        const ttsResult = await this.getGoogleTtsPlayback(sayText);
        playUrlResult = ttsResult?.playback ?? null;
        ttsCacheHit = ttsResult?.cacheHit ?? false;
        ttsMs = Math.max(0, Date.now() - ttsStartedAt);
      }
      const now = Date.now();
      const isFirstResponse = typeof session.lastResponseAt !== "number";
      const responseTwiml = buildStreamingTwiml({
        streamUrl: session.streamUrl,
        streamParams: {
          tenantId: session.tenantId,
          leadId: session.leadId,
        },
        playUrl: playUrlResult?.url,
        sayText: playUrlResult?.url ? undefined : sayText,
        keepAliveSec: this.config.voiceStreamingKeepAliveSec,
        hangup,
        track: this.config.voiceStreamingTrack,
      });

      const twilioUpdateStartedAt = Date.now();
      const twilioUpdated = await this.voiceCallService.updateCallTwiml(
        session.callSid,
        responseTwiml,
      );
      twilioUpdateMs = Math.max(0, Date.now() - twilioUpdateStartedAt);
      session.lastResponseText = sayText;
      session.lastResponseAt = now;
      if (hangup) {
        this.scheduleForcedHangupIfNeeded(session, sayText);
      }
      logTurnTiming({
        reason: hadNoSayMessages
          ? twilioUpdated
            ? "no_say_fallback_updated"
            : "no_say_fallback_update_failed"
          : twilioUpdated
            ? "twiml_updated"
            : "twiml_update_failed",
        twilioUpdated,
        usedGoogleTts: Boolean(playUrlResult?.url),
        ttsCacheHit,
        ttsPolicy: playUrlResult?.url ? "google_play" : "twilio_say",
        hangup,
        isFirstResponse,
      });
    } catch (error) {
      turnLogicMs = turnLogicMs || Math.max(0, Date.now() - turnStartedAt);
      this.loggingService.warn(
        {
          event: "voice.stream.turn_failed",
          tenantId: session.tenantId,
          callSid: session.callSid,
          streamSid: session.streamSid,
          sttFinalMs: sttFinalMs ?? null,
          queueDelayMs,
          turnLogicMs,
          aiMs: timingCollector.aiMs,
          aiCalls: timingCollector.aiCalls,
          ttsMs,
          twilioUpdateMs,
          reason: error instanceof Error ? error.message : String(error),
        },
        VoiceStreamGateway.name,
      );
    } finally {
      session.processing = false;
      const pending = session.pendingTranscript;
      session.pendingTranscript = undefined;
      if (pending && !session.closed) {
        void this.handleFinalTranscript(
          session,
          pending.transcript,
          pending.confidence,
          pending.sttFinalMs,
          pending.queuedAtMs,
        );
      }
    }
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
    const session = this.sessions.get(client);
    if (session) {
      session.closed = true;
      this.speechRuntime.closeSpeechStream(session.speechStream);
      if (this.callSessions.get(session.callSid) === client) {
        this.callSessions.delete(session.callSid);
      }
      this.sessions.delete(client);
    }
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
