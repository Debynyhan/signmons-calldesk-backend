import { protos } from "@google-cloud/speech";
import type { AppConfig } from "../config/app.config";
import { ConversationsService } from "../conversations/conversations.service";
import { runWithRequestContext } from "../common/context/request-context";
import { LoggingService } from "../logging/logging.service";
import { VoiceCallService } from "./voice-call.service";
import { VoiceFillerAudioService } from "./voice-filler-audio.service";
import { VoiceTurnService } from "./voice-turn.service";
import {
  buildStreamingTwiml,
  extractSayMessages,
  hasHangup,
} from "./voice-streaming.utils";
import type { VoiceStreamSession } from "./voice-stream.types";

type TurnTimingCollector = {
  aiMs: number;
  aiCalls: number;
};

type TurnTimingParams = {
  sttFinalMs: number | null;
  queueDelayMs: number | null;
  turnLogicMs: number;
  ttsMs: number;
  twilioUpdateMs: number;
};

type TurnLatencyBreachParams = {
  sttFinalMs: number | null;
  aiMs: number;
  ttsMs: number;
  twilioUpdateMs: number;
  totalTurnMs: number;
  isFirstResponse: boolean;
};

type TurnGoogleTtsResult = {
  playback: { url: string; objectPath: string };
  cacheHit: boolean;
};

type TurnExecutionPolicies = {
  isFillerTranscript: (transcript: string) => boolean;
  buildNoSayFallbackText: (transcript: string) => string;
  normalizeTranscriptForDeduplication: (value: string) => string;
  scheduleForcedHangupIfNeeded: (
    session: VoiceStreamSession,
    closingText: string,
  ) => void;
  shouldUseGoogleTtsForText: (
    text: string,
    options?: { hangup?: boolean },
  ) => boolean;
  computeTotalTurnMs: (params: TurnTimingParams) => number;
  getTurnLatencyBreaches: (params: TurnLatencyBreachParams) => string[];
  getGoogleTtsPlayback: (
    text: string,
  ) => Promise<TurnGoogleTtsResult | null>;
};

export class VoiceStreamTurnExecutionRuntime {
  private static readonly LOG_SOURCE = "VoiceStreamGateway";

  constructor(
    private readonly config: AppConfig,
    private readonly conversationsService: ConversationsService,
    private readonly voiceCallService: VoiceCallService,
    private readonly voiceTurnService: VoiceTurnService,
    private readonly voiceFillerAudioService: VoiceFillerAudioService,
    private readonly loggingService: LoggingService,
    private readonly policies: TurnExecutionPolicies,
  ) {}

  handleSpeechData(
    session: VoiceStreamSession,
    data: protos.google.cloud.speech.v1.IStreamingRecognizeResponse,
  ): void {
    const result = data.results?.[0];
    const alternative = result?.alternatives?.[0];
    const transcript = alternative?.transcript?.trim();
    if (!transcript) {
      return;
    }
    if (!result?.isFinal) {
      return;
    }
    if (this.policies.isFillerTranscript(transcript)) {
      return;
    }
    const normalizedTranscript =
      this.policies.normalizeTranscriptForDeduplication(transcript);
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

  async handleFinalTranscript(
    session: VoiceStreamSession,
    transcript: string,
    confidence?: number,
    sttFinalMs?: number,
    queuedAtMs?: number,
  ): Promise<void> {
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
    const timingCollector: TurnTimingCollector = { aiMs: 0, aiCalls: 0 };
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
      const totalTurnMs = this.policies.computeTotalTurnMs({
        sttFinalMs: sttFinalMsValue,
        queueDelayMs: queueDelayMsValue,
        turnLogicMs,
        ttsMs,
        twilioUpdateMs,
      });
      const latencyBreaches = this.policies.getTurnLatencyBreaches({
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
        VoiceStreamTurnExecutionRuntime.LOG_SOURCE,
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
          VoiceStreamTurnExecutionRuntime.LOG_SOURCE,
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
            VoiceStreamTurnExecutionRuntime.LOG_SOURCE,
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
        ? this.policies.buildNoSayFallbackText(transcript)
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
          VoiceStreamTurnExecutionRuntime.LOG_SOURCE,
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
          VoiceStreamTurnExecutionRuntime.LOG_SOURCE,
        );
      }
      const useGoogleTts =
        !hadNoSayMessages &&
        this.policies.shouldUseGoogleTtsForText(sayText, { hangup });
      let ttsCacheHit = false;
      let playUrlResult: { url: string; objectPath: string } | null = null;
      if (useGoogleTts) {
        const ttsStartedAt = Date.now();
        const ttsResult = await this.policies.getGoogleTtsPlayback(sayText);
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
        this.policies.scheduleForcedHangupIfNeeded(session, sayText);
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
        VoiceStreamTurnExecutionRuntime.LOG_SOURCE,
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
}
