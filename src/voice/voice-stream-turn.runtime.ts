import { createHash } from "crypto";
import type { AppConfig } from "../config/app.config";
import { GoogleTtsService } from "../google/google-tts.service";

type TurnTotalMsParams = {
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

type GoogleTtsPlaybackResult = {
  playback: { url: string; objectPath: string };
  cacheHit: boolean;
};

export class VoiceStreamTurnRuntime {
  private static readonly TTS_SIGNED_URL_SKEW_MS = 5_000;
  private static readonly TTS_SIGNED_URL_CACHE_MAX = 200;
  private static readonly TURN_TOTAL_WARN_MS = 4_500;
  private static readonly TURN_STT_WARN_MS = 1_800;
  private static readonly TURN_AI_WARN_MS = 1_800;
  private static readonly TURN_TTS_WARN_MS = 1_600;
  private static readonly TURN_TWILIO_UPDATE_WARN_MS = 1_200;
  private static readonly FIRST_RESPONSE_WARN_MS = 5_500;

  private readonly googleTtsSignedUrlCache = new Map<
    string,
    { url: string; objectPath: string; expiresAtMs: number }
  >();

  constructor(
    private readonly config: AppConfig,
    private readonly googleTtsService: GoogleTtsService,
  ) {}

  isFillerTranscript(transcript: string): boolean {
    const normalized = transcript.toLowerCase().trim();
    if (!normalized) {
      return true;
    }
    const collapsed = normalized
      .replace(/[^a-z0-9\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/\d/.test(normalized)) {
      return false;
    }
    if (collapsed.length <= 2) {
      return true;
    }
    if (/^(uh|um|hmm|mm hmm|mhm)$/.test(collapsed)) {
      return true;
    }
    if (
      /^(i just|just|i was|because|and|but|so|well|hold on|hang on|one sec|one second|just a sec|give me a sec|wait)$/.test(
        collapsed,
      )
    ) {
      return true;
    }
    return /\b(thank you for calling|this call may be recorded|this call may be transcribed)\b/.test(
      normalized,
    );
  }

  buildNoSayFallbackText(transcript: string): string {
    const normalized = this.normalizeTranscriptForDeduplication(transcript);
    if (normalized.length >= 3) {
      return "Thanks, I heard you. Please say that one more time so I can make sure I got it right.";
    }
    return "I am still here. Please tell me what you need help with today.";
  }

  normalizeTranscriptForDeduplication(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  shouldUseGoogleTts(): boolean {
    return (
      this.config.voiceTtsProvider === "google" && this.googleTtsService.isEnabled()
    );
  }

  shouldUseGoogleTtsForText(
    text: string,
    options?: { hangup?: boolean },
  ): boolean {
    if (!this.shouldUseGoogleTts()) {
      return false;
    }
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return false;
    }
    if (options?.hangup) {
      return true;
    }
    if (this.shouldPreferTwilioSayForLatency(normalized)) {
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

  shouldPreferTwilioSayForLatency(normalizedText: string): boolean {
    const words = normalizedText.split(/\s+/).filter(Boolean);
    if (words.length <= 10) {
      return true;
    }
    if (/\?$/.test(normalizedText) && words.length <= 28) {
      return true;
    }
    if (
      /^(thanks|got it|okay|ok|perfect|please|can you|could you|would you|what('?s| is)|is this)\b/i.test(
        normalizedText,
      )
    ) {
      return words.length <= 20;
    }
    return false;
  }

  computeTotalTurnMs(params: TurnTotalMsParams): number {
    return (
      (params.sttFinalMs ?? 0) +
      (params.queueDelayMs ?? 0) +
      Math.max(0, params.turnLogicMs) +
      Math.max(0, params.ttsMs) +
      Math.max(0, params.twilioUpdateMs)
    );
  }

  getTurnLatencyBreaches(params: TurnLatencyBreachParams): string[] {
    const breaches: string[] = [];
    if (
      typeof params.sttFinalMs === "number" &&
      params.sttFinalMs > VoiceStreamTurnRuntime.TURN_STT_WARN_MS
    ) {
      breaches.push("stt_final_slow");
    }
    if (params.aiMs > VoiceStreamTurnRuntime.TURN_AI_WARN_MS) {
      breaches.push("ai_slow");
    }
    if (params.ttsMs > VoiceStreamTurnRuntime.TURN_TTS_WARN_MS) {
      breaches.push("tts_slow");
    }
    if (
      params.twilioUpdateMs > VoiceStreamTurnRuntime.TURN_TWILIO_UPDATE_WARN_MS
    ) {
      breaches.push("twilio_update_slow");
    }
    if (params.totalTurnMs > VoiceStreamTurnRuntime.TURN_TOTAL_WARN_MS) {
      breaches.push("turn_total_slow");
    }
    if (
      params.isFirstResponse &&
      params.totalTurnMs > VoiceStreamTurnRuntime.FIRST_RESPONSE_WARN_MS
    ) {
      breaches.push("first_response_slow");
    }
    return breaches;
  }

  async getGoogleTtsPlayback(
    text: string,
  ): Promise<GoogleTtsPlaybackResult | null> {
    const normalizedText = this.normalizeTtsCacheText(text);
    if (!normalizedText) {
      return null;
    }
    const nowMs = Date.now();
    this.pruneGoogleTtsSignedUrlCache(nowMs);
    const hash = this.buildTtsTextHash(normalizedText);
    const cached = this.googleTtsSignedUrlCache.get(hash);
    if (
      cached &&
      cached.expiresAtMs > nowMs + VoiceStreamTurnRuntime.TTS_SIGNED_URL_SKEW_MS
    ) {
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

  private normalizeTtsCacheText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private buildTtsTextHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  private pruneGoogleTtsSignedUrlCache(nowMs = Date.now()): void {
    for (const [key, entry] of this.googleTtsSignedUrlCache.entries()) {
      if (
        entry.expiresAtMs <=
        nowMs + VoiceStreamTurnRuntime.TTS_SIGNED_URL_SKEW_MS
      ) {
        this.googleTtsSignedUrlCache.delete(key);
      }
    }
    while (
      this.googleTtsSignedUrlCache.size > VoiceStreamTurnRuntime.TTS_SIGNED_URL_CACHE_MAX
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
}
