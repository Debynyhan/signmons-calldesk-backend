import { createHash } from "crypto";
import { Injectable, Inject } from "@nestjs/common";
import { OnModuleInit } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../config/app.config";
import { GoogleTtsService } from "../google/google-tts.service";
import { LoggingService } from "../logging/logging.service";

type FillerEntry = {
  objectPath: string;
  signedUrl: string | null;
  expiresAtMs: number;
  refreshing: boolean;
};

const FILLER_TEXTS = [
  "Just a moment.",
  "Let me check that.",
  "Sure, one sec.",
  "Got it, one moment.",
];

// Refresh signed URLs when they have less than this long remaining.
const SIGNED_URL_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

@Injectable()
export class VoiceFillerAudioService implements OnModuleInit {
  private readonly entries: FillerEntry[] = [];

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly googleTtsService: GoogleTtsService,
    private readonly loggingService: LoggingService,
  ) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      return;
    }
    for (const text of FILLER_TEXTS) {
      const objectPath = this.buildObjectPath(text);
      this.entries.push({
        objectPath,
        signedUrl: null,
        expiresAtMs: 0,
        refreshing: false,
      });
      this.synthesizeAndRefresh(objectPath);
    }
  }

  /**
   * Returns a random filler clip URL, or null if none are ready.
   * Triggers background refresh for any entries approaching expiry.
   */
  getFillerUrl(): string | null {
    if (!this.isEnabled() || this.entries.length === 0) {
      return null;
    }
    const now = Date.now();
    const ready: FillerEntry[] = [];
    for (const entry of this.entries) {
      if (entry.signedUrl && entry.expiresAtMs > now) {
        ready.push(entry);
        if (
          !entry.refreshing &&
          entry.expiresAtMs - now < SIGNED_URL_REFRESH_THRESHOLD_MS
        ) {
          this.synthesizeAndRefresh(entry.objectPath);
        }
      } else if (!entry.refreshing) {
        this.synthesizeAndRefresh(entry.objectPath);
      }
    }
    if (ready.length === 0) {
      return null;
    }
    return ready[Math.floor(Math.random() * ready.length)]!.signedUrl;
  }

  private isEnabled(): boolean {
    return (
      this.config.voiceTtsProvider === "google" &&
      this.config.googleTtsEnabled &&
      Boolean(this.config.googleTtsBucket)
    );
  }

  private synthesizeAndRefresh(objectPath: string): void {
    const entry = this.entries.find((e) => e.objectPath === objectPath);
    if (!entry || entry.refreshing) {
      return;
    }
    entry.refreshing = true;
    void this.googleTtsService
      .synthesizeToObjectPath({
        text: this.objectPathToText(objectPath),
        objectPath,
      })
      .then(async () => {
        const signedUrl =
          await this.googleTtsService.getSignedUrlIfExists(objectPath);
        if (entry && signedUrl) {
          const ttlSec =
            Number.isFinite(this.config.googleTtsSignedUrlTtlSec) &&
            this.config.googleTtsSignedUrlTtlSec > 0
              ? this.config.googleTtsSignedUrlTtlSec
              : 900;
          entry.signedUrl = signedUrl;
          entry.expiresAtMs = Date.now() + ttlSec * 1000;
        }
      })
      .catch((error: unknown) => {
        this.loggingService.warn(
          {
            event: "voice.filler_audio_warm_failed",
            objectPath,
            reason: error instanceof Error ? error.message : String(error),
          },
          VoiceFillerAudioService.name,
        );
      })
      .finally(() => {
        if (entry) {
          entry.refreshing = false;
        }
      });
  }

  private buildObjectPath(text: string): string {
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          text,
          voiceName: this.config.googleTtsVoiceName,
          languageCode: this.config.googleTtsLanguageCode,
          audioEncoding: this.config.googleTtsAudioEncoding,
        }),
      )
      .digest("hex")
      .slice(0, 16);
    const extension = this.googleTtsService.getAudioExtension();
    return `tts/filler/${hash}.${extension}`;
  }

  /** Reverse-maps an objectPath back to its filler text for synthesis. */
  private objectPathToText(objectPath: string): string {
    for (const text of FILLER_TEXTS) {
      if (this.buildObjectPath(text) === objectPath) {
        return text;
      }
    }
    return FILLER_TEXTS[0]!;
  }
}
