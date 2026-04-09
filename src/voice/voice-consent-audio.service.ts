import { createHash } from "crypto";
import { Injectable, Inject } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../config/app.config";
import { GoogleTtsService } from "../google/google-tts.service";
import { LoggingService } from "../logging/logging.service";

type ConsentCacheEntry = {
  objectPath: string;
  exists: boolean;
  checkedAt: number;
};

@Injectable()
export class VoiceConsentAudioService {
  private readonly cache = new Map<string, ConsentCacheEntry>();
  private readonly inFlight = new Set<string>();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly googleTtsService: GoogleTtsService,
    private readonly loggingService: LoggingService,
  ) {}

  async getCachedConsentUrl(
    tenantId: string,
    consentMessage: string,
  ): Promise<string | null> {
    if (
      this.config.voiceTtsProvider !== "google" ||
      !this.config.googleTtsEnabled ||
      !this.config.googleTtsBucket
    ) {
      return null;
    }
    const objectPath = this.buildObjectPath(tenantId, consentMessage);
    const cached = this.cache.get(objectPath);
    const now = Date.now();
    if (cached && now - cached.checkedAt < this.cacheTtlMs) {
      if (!cached.exists) {
        return null;
      }
      return this.googleTtsService.getSignedUrlIfExists(objectPath);
    }
    const url = await this.googleTtsService.getSignedUrlIfExists(objectPath);
    this.cache.set(objectPath, {
      objectPath,
      exists: Boolean(url),
      checkedAt: now,
    });
    return url;
  }

  /**
   * Synthesizes and returns a signed URL for the consent audio, waiting inline
   * if the audio hasn't been generated yet. Falls back to null on error.
   * Use this on the first inbound call for a tenant to avoid a Twilio→Google
   * voice switch mid-conversation.
   */
  async synthesizeAndGetUrl(
    tenantId: string,
    consentMessage: string,
  ): Promise<string | null> {
    if (
      this.config.voiceTtsProvider !== "google" ||
      !this.config.googleTtsEnabled ||
      !this.config.googleTtsBucket
    ) {
      return null;
    }
    const objectPath = this.buildObjectPath(tenantId, consentMessage);
    try {
      await this.googleTtsService.synthesizeToObjectPath({
        text: consentMessage,
        objectPath,
      });
      const url = await this.googleTtsService.getSignedUrlIfExists(objectPath);
      if (url) {
        this.cache.set(objectPath, {
          objectPath,
          exists: true,
          checkedAt: Date.now(),
        });
      }
      return url;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.loggingService.warn(
        {
          event: "voice.consent_audio_synthesize_failed",
          tenantId,
          reason: errorMessage,
        },
        VoiceConsentAudioService.name,
      );
      return null;
    }
  }

  warmConsentAudio(tenantId: string, consentMessage: string): void {
    if (
      this.config.voiceTtsProvider !== "google" ||
      !this.config.googleTtsEnabled ||
      !this.config.googleTtsBucket
    ) {
      return;
    }
    const objectPath = this.buildObjectPath(tenantId, consentMessage);
    if (this.inFlight.has(objectPath)) {
      return;
    }
    this.inFlight.add(objectPath);
    void this.googleTtsService
      .synthesizeToObjectPath({
        text: consentMessage,
        objectPath,
      })
      .then((created) => {
        this.cache.set(objectPath, {
          objectPath,
          exists: created,
          checkedAt: Date.now(),
        });
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.loggingService.warn(
          {
            event: "voice.consent_audio_warm_failed",
            tenantId,
            reason: errorMessage,
          },
          VoiceConsentAudioService.name,
        );
      })
      .finally(() => {
        this.inFlight.delete(objectPath);
      });
  }

  private buildObjectPath(tenantId: string, consentMessage: string): string {
    const hash = this.buildConsentHash(tenantId, consentMessage);
    const extension = this.googleTtsService.getAudioExtension();
    return `tts/consent/${tenantId}/${hash}.${extension}`;
  }

  private buildConsentHash(tenantId: string, consentMessage: string): string {
    const payload = JSON.stringify({
      tenantId,
      consentMessage,
      voiceName: this.config.googleTtsVoiceName,
      languageCode: this.config.googleTtsLanguageCode,
      audioEncoding: this.config.googleTtsAudioEncoding,
      speakingRate: this.config.googleTtsSpeakingRate,
      pitch: this.config.googleTtsPitch,
      volumeGainDb: this.config.googleTtsVolumeGainDb,
    });
    return createHash("sha256").update(payload).digest("hex").slice(0, 16);
  }
}
