import { Inject } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from "@nestjs/websockets";
import { createHash } from "crypto";
import { protos } from "@google-cloud/speech";
import type { RawData, WebSocket } from "ws";
import appConfig, { type AppConfig } from "../config/app.config";
import { LoggingService } from "../logging/logging.service";
import { GoogleSpeechService } from "../google/google-speech.service";
import { GoogleTtsService } from "../google/google-tts.service";
import { ConversationsService } from "../conversations/conversations.service";
import { VoiceCallService } from "./voice-call.service";
import { VoiceTurnService } from "./voice-turn.service";
import {
  buildStreamUrl,
  buildStreamingTwiml,
  extractSayMessages,
  hasHangup,
  VOICE_STREAM_PATH,
} from "./voice-streaming.utils";
import { runWithRequestContext } from "../common/context/request-context";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import type { TenantOrganization } from "@prisma/client";

type TwilioStreamStart = {
  event: "start";
  start: {
    callSid: string;
    streamSid: string;
    customParameters?: Record<string, string>;
  };
};

type TwilioStreamMedia = {
  event: "media";
  media: {
    payload: string;
  };
};

type TwilioStreamStop = {
  event: "stop";
  stop: {
    callSid?: string;
    streamSid?: string;
  };
};

type TwilioStreamMessage =
  | TwilioStreamStart
  | TwilioStreamMedia
  | TwilioStreamStop;

type VoicePendingTranscript = {
  transcript: string;
  confidence?: number;
  sttFinalMs?: number;
  queuedAtMs: number;
};

type VoiceStreamSession = {
  callSid: string;
  streamSid: string;
  tenantId: string;
  tenant: TenantOrganization;
  leadId?: string;
  streamUrl: string;
  speechStream: NodeJS.ReadWriteStream;
  processing: boolean;
  startedAtMs: number;
  lastMediaAtMs?: number;
  pendingTranscript?: VoicePendingTranscript;
  lastTranscript?: string;
  lastTranscriptAt?: number;
  lastResponseText?: string;
  lastResponseAt?: number;
  speechRestartCount: number;
  lastSpeechRestartAtMs?: number;
  restartingSpeechStream?: boolean;
  closed: boolean;
};

@WebSocketGateway({ path: VOICE_STREAM_PATH })
export class VoiceStreamGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private static readonly TTS_SIGNED_URL_SKEW_MS = 5_000;
  private static readonly TTS_SIGNED_URL_CACHE_MAX = 200;
  private static readonly SPEECH_STREAM_RESTART_MAX = 3;
  private static readonly SPEECH_STREAM_RESTART_WINDOW_MS = 60_000;

  private readonly sessions = new Map<WebSocket, VoiceStreamSession>();
  private readonly callSessions = new Map<string, WebSocket>();
  private readonly lastResponseByCall = new Map<
    string,
    { text: string; at: number }
  >();
  private readonly googleTtsSignedUrlCache = new Map<
    string,
    { url: string; objectPath: string; expiresAtMs: number }
  >();

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
    private readonly loggingService: LoggingService,
  ) {}

  handleConnection(client: WebSocket) {
    client.on("message", (data: RawData) => {
      void this.handleMessage(client, data);
    });
  }

  handleDisconnect(client: WebSocket) {
    this.cleanupSession(client);
  }

  private async handleMessage(client: WebSocket, data: RawData) {
    const message = this.parseMessage(data);
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

  private parseMessage(data: RawData): TwilioStreamMessage | null {
    const text = this.rawDataToString(data);
    try {
      return JSON.parse(text) as TwilioStreamMessage;
    } catch (error) {
      this.loggingService.warn(
        {
          event: "voice.stream.invalid_message",
          payload: text,
          reason: error instanceof Error ? error.message : String(error),
        },
        VoiceStreamGateway.name,
      );
      return null;
    }
  }

  private rawDataToString(data: RawData): string {
    if (typeof data === "string") {
      return data;
    }
    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data).toString("utf8");
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString("utf8");
    }
    return "";
  }

  private async handleStart(client: WebSocket, message: TwilioStreamStart) {
    if (!this.config.voiceStreamingEnabled) {
      client.close();
      return;
    }
    if (this.config.voiceSttProvider !== "google") {
      this.loggingService.warn(
        { event: "voice.stream.stt_provider_disabled" },
        VoiceStreamGateway.name,
      );
      client.close();
      return;
    }
    if (!this.googleSpeechService.isEnabled()) {
      this.loggingService.warn(
        { event: "voice.stream.speech_disabled" },
        VoiceStreamGateway.name,
      );
      client.close();
      return;
    }
    if (!this.config.twilioWebhookBaseUrl) {
      this.loggingService.warn(
        { event: "voice.stream.missing_base_url" },
        VoiceStreamGateway.name,
      );
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

    const params = message.start.customParameters ?? {};
    const tenantId = params.tenantId ?? this.config.demoTenantId;
    if (!tenantId) {
      this.loggingService.warn(
        { event: "voice.stream.missing_tenant", callSid },
        VoiceStreamGateway.name,
      );
      client.close();
      return;
    }
    const tenant = await this.tenantsService.getTenantById(tenantId);
    if (!tenant) {
      this.loggingService.warn(
        { event: "voice.stream.tenant_not_found", callSid, tenantId },
        VoiceStreamGateway.name,
      );
      client.close();
      return;
    }

    const leadId = params.leadId;
    await this.conversationsService.ensureVoiceConsentConversation({
      tenantId: tenant.id,
      callSid,
      requestId: leadId,
    });

    const speechStream =
      this.googleSpeechService.createStreamingRecognizeStream();
    if (!speechStream) {
      client.close();
      return;
    }

    const streamUrl = buildStreamUrl(
      this.config.twilioWebhookBaseUrl,
      VOICE_STREAM_PATH,
    );
    const session: VoiceStreamSession = {
      callSid,
      streamSid,
      tenantId: tenant.id,
      tenant,
      leadId,
      streamUrl,
      speechStream,
      processing: false,
      startedAtMs: Date.now(),
      speechRestartCount: 0,
      closed: false,
    };
    this.sessions.set(client, session);
    this.callSessions.set(callSid, client);
    this.loggingService.log(
      {
        event: "voice.stream.started",
        callSid,
        streamSid,
        tenantId: tenant.id,
        streamUrl,
      },
      VoiceStreamGateway.name,
    );

    this.attachSpeechStreamHandlers(client, session, speechStream);
  }

  private handleMedia(client: WebSocket, message: TwilioStreamMedia) {
    const session = this.sessions.get(client);
    if (!session) {
      return;
    }
    if (session.closed || !this.isWritableStream(session.speechStream)) {
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
    this.loggingService.log(
      {
        event: "voice.stream.stopped",
        callSid: message.stop.callSid ?? session.callSid,
        streamSid: message.stop.streamSid ?? session.streamSid,
      },
      VoiceStreamGateway.name,
    );
    this.cleanupSession(client);
  }

  private attachSpeechStreamHandlers(
    client: WebSocket,
    session: VoiceStreamSession,
    speechStream: NodeJS.ReadWriteStream,
  ) {
    speechStream.on("data", (data) => {
      this.handleSpeechData(
        session,
        data as protos.google.cloud.speech.v1.IStreamingRecognizeResponse,
      );
    });
    speechStream.on("error", (error) => {
      void this.handleSpeechStreamError(client, session, error);
    });
  }

  private async handleSpeechStreamError(
    client: WebSocket,
    session: VoiceStreamSession,
    error: unknown,
  ): Promise<void> {
    if (session.closed) {
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (this.isRecoverableSpeechStreamError(error)) {
      const restarted = this.tryRestartSpeechStream(client, session, reason);
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
      VoiceStreamGateway.name,
    );
    this.cleanupSession(client);
    try {
      client.close();
    } catch {
      // Best effort socket close.
    }
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
        VoiceStreamGateway.SPEECH_STREAM_RESTART_WINDOW_MS
    ) {
      session.speechRestartCount = 0;
    }
    if (session.speechRestartCount >= VoiceStreamGateway.SPEECH_STREAM_RESTART_MAX) {
      this.loggingService.warn(
        {
          event: "voice.stream.speech_restart_exhausted",
          callSid: session.callSid,
          streamSid: session.streamSid,
          restartCount: session.speechRestartCount,
          reason,
        },
        VoiceStreamGateway.name,
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
          VoiceStreamGateway.name,
        );
        return false;
      }
      this.closeSpeechStream(session.speechStream);
      session.speechStream = nextSpeechStream;
      session.speechRestartCount += 1;
      session.lastSpeechRestartAtMs = nowMs;
      this.attachSpeechStreamHandlers(client, session, nextSpeechStream);
      this.loggingService.log(
        {
          event: "voice.stream.speech_restarted",
          callSid: session.callSid,
          streamSid: session.streamSid,
          restartCount: session.speechRestartCount,
          reason,
        },
        VoiceStreamGateway.name,
      );
      return true;
    } finally {
      session.restartingSpeechStream = false;
    }
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
    }) => {
      this.loggingService.log(
        {
          event: "voice.stream.turn_timing",
          tenantId: session.tenantId,
          callSid: session.callSid,
          streamSid: session.streamSid,
          sttFinalMs: sttFinalMs ?? null,
          turnLogicMs,
          aiMs: timingCollector.aiMs,
          aiCalls: timingCollector.aiCalls,
          ttsMs,
          twilioUpdateMs,
          transcriptChars: transcript.length,
          queueDelayMs,
          reason: params.reason,
          twilioUpdated: params.twilioUpdated,
          usedGoogleTts: params.usedGoogleTts ?? false,
          ttsCacheHit: params.ttsCacheHit ?? false,
          ttsPolicy: params.ttsPolicy ?? "twilio_say",
          hangup: params.hangup ?? false,
        },
        VoiceStreamGateway.name,
      );
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

      const messages = extractSayMessages(twiml);
      if (!messages.length) {
        logTurnTiming({
          reason: "no_say_messages",
          twilioUpdated: false,
          ttsPolicy: "twilio_say",
        });
        return;
      }
      const sayText = messages.join(" ");
      const useGoogleTts = this.shouldUseGoogleTtsForText(sayText);
      let ttsCacheHit = false;
      let playUrlResult: { url: string; objectPath: string } | null = null;
      if (useGoogleTts) {
        const ttsStartedAt = Date.now();
        const ttsResult = await this.getGoogleTtsPlayback(sayText);
        playUrlResult = ttsResult?.playback ?? null;
        ttsCacheHit = ttsResult?.cacheHit ?? false;
        ttsMs = Math.max(0, Date.now() - ttsStartedAt);
      }
      const hangup = hasHangup(twiml);
      const now = Date.now();
      if (!hangup) {
        const lastResponse = this.lastResponseByCall.get(session.callSid);
        if (
          lastResponse &&
          lastResponse.text === sayText &&
          now - lastResponse.at < 2000
        ) {
          logTurnTiming({
            reason: "duplicate_response_suppressed",
            twilioUpdated: false,
            usedGoogleTts: Boolean(playUrlResult?.url),
            ttsCacheHit,
            ttsPolicy: playUrlResult?.url ? "google_play" : "twilio_say",
            hangup,
          });
          return;
        }
        if (
          session.lastResponseText === sayText &&
          session.lastResponseAt &&
          now - session.lastResponseAt < 2000
        ) {
          logTurnTiming({
            reason: "duplicate_response_suppressed",
            twilioUpdated: false,
            usedGoogleTts: Boolean(playUrlResult?.url),
            ttsCacheHit,
            ttsPolicy: playUrlResult?.url ? "google_play" : "twilio_say",
            hangup,
          });
          return;
        }
      }
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
      this.lastResponseByCall.set(session.callSid, { text: sayText, at: now });
      logTurnTiming({
        reason: twilioUpdated ? "twiml_updated" : "twiml_update_failed",
        twilioUpdated,
        usedGoogleTts: Boolean(playUrlResult?.url),
        ttsCacheHit,
        ttsPolicy: playUrlResult?.url ? "google_play" : "twilio_say",
        hangup,
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
    const normalized = transcript.toLowerCase().trim();
    if (!normalized) {
      return true;
    }
    if (/\d/.test(normalized)) {
      return false;
    }
    if (normalized.length <= 2) {
      return true;
    }
    return /\b(hold on|hang on|one sec|one second|just a sec|give me a sec|wait|um|uh|hmm|thank you for calling|this call may be recorded|this call may be transcribed)\b/.test(
      normalized,
    );
  }

  private normalizeTranscriptForDeduplication(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private cleanupSession(client: WebSocket) {
    const session = this.sessions.get(client);
    if (session) {
      session.closed = true;
      this.closeSpeechStream(session.speechStream);
      if (this.callSessions.get(session.callSid) === client) {
        this.callSessions.delete(session.callSid);
      }
      this.sessions.delete(client);
    }
  }

  private closeSpeechStream(stream: NodeJS.ReadWriteStream) {
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

  private isWritableStream(stream: NodeJS.ReadWriteStream): boolean {
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

  private shouldUseGoogleTts(): boolean {
    return (
      this.config.voiceTtsProvider === "google" && this.googleTtsService.isEnabled()
    );
  }

  private shouldUseGoogleTtsForText(text: string): boolean {
    if (!this.shouldUseGoogleTts()) {
      return false;
    }
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return false;
    }
    const shortSayLimit = Math.max(
      0,
      Math.floor(this.config.voiceTtsShortSayMaxChars ?? 0),
    );
    if (shortSayLimit > 0 && normalized.length <= shortSayLimit) {
      return false;
    }
    return true;
  }

  private normalizeTtsCacheText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private buildTtsTextHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  private pruneGoogleTtsSignedUrlCache(nowMs = Date.now()): void {
    for (const [key, entry] of this.googleTtsSignedUrlCache.entries()) {
      if (entry.expiresAtMs <= nowMs + VoiceStreamGateway.TTS_SIGNED_URL_SKEW_MS) {
        this.googleTtsSignedUrlCache.delete(key);
      }
    }
    while (
      this.googleTtsSignedUrlCache.size > VoiceStreamGateway.TTS_SIGNED_URL_CACHE_MAX
    ) {
      const oldestKey = this.googleTtsSignedUrlCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) {
        break;
      }
      this.googleTtsSignedUrlCache.delete(oldestKey);
    }
  }

  private async getGoogleTtsPlayback(text: string): Promise<{
    playback: { url: string; objectPath: string };
    cacheHit: boolean;
  } | null> {
    const normalizedText = this.normalizeTtsCacheText(text);
    if (!normalizedText) {
      return null;
    }
    const nowMs = Date.now();
    this.pruneGoogleTtsSignedUrlCache(nowMs);
    const hash = this.buildTtsTextHash(normalizedText);
    const cached = this.googleTtsSignedUrlCache.get(hash);
    if (cached && cached.expiresAtMs > nowMs + VoiceStreamGateway.TTS_SIGNED_URL_SKEW_MS) {
      return {
        playback: { url: cached.url, objectPath: cached.objectPath },
        cacheHit: true,
      };
    }

    const objectPath = `tts/cache/${hash}.${this.googleTtsService.getAudioExtension()}`;
    const synthesized = await this.googleTtsService.synthesizeToObjectPath({
      text: normalizedText,
      objectPath,
    });
    if (!synthesized) {
      return null;
    }
    const signedUrl = await this.googleTtsService.getSignedUrlIfExists(objectPath);
    if (!signedUrl) {
      return null;
    }

    const configuredTtlSec = this.config.googleTtsSignedUrlTtlSec;
    const ttlSec =
      Number.isFinite(configuredTtlSec) && configuredTtlSec > 0
        ? configuredTtlSec
        : 900;
    this.googleTtsSignedUrlCache.set(hash, {
      url: signedUrl,
      objectPath,
      expiresAtMs: nowMs + ttlSec * 1000,
    });
    return {
      playback: { url: signedUrl, objectPath },
      cacheHit: false,
    };
  }
}
