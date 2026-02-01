import { Injectable, Inject } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { randomUUID } from "crypto";
import { Storage } from "@google-cloud/storage";
import { TextToSpeechClient, protos } from "@google-cloud/text-to-speech";
import appConfig from "../config/app.config";
import { LoggingService } from "../logging/logging.service";

const AUDIO_ENCODING_MAP: Record<
  "MP3" | "OGG_OPUS" | "LINEAR16",
  protos.google.cloud.texttospeech.v1.AudioEncoding
> = {
  MP3: protos.google.cloud.texttospeech.v1.AudioEncoding.MP3,
  OGG_OPUS: protos.google.cloud.texttospeech.v1.AudioEncoding.OGG_OPUS,
  LINEAR16: protos.google.cloud.texttospeech.v1.AudioEncoding.LINEAR16,
};

const AUDIO_EXTENSION_MAP: Record<"MP3" | "OGG_OPUS" | "LINEAR16", string> = {
  MP3: "mp3",
  OGG_OPUS: "ogg",
  LINEAR16: "wav",
};

const AUDIO_CONTENT_TYPE_MAP: Record<"MP3" | "OGG_OPUS" | "LINEAR16", string> =
  {
    MP3: "audio/mpeg",
    OGG_OPUS: "audio/ogg",
    LINEAR16: "audio/wav",
  };

const MAX_TTS_CHARS = 800;

@Injectable()
export class GoogleTtsService {
  private readonly ttsClient = new TextToSpeechClient();
  private readonly storage = new Storage();

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly loggingService: LoggingService,
  ) {}

  isEnabled(): boolean {
    return this.config.googleTtsEnabled;
  }

  getAudioExtension(): string {
    return AUDIO_EXTENSION_MAP[this.config.googleTtsAudioEncoding] ?? "mp3";
  }

  async getSignedUrlIfExists(objectPath: string): Promise<string | null> {
    if (!this.config.googleTtsEnabled) {
      return null;
    }
    const bucketName = this.config.googleTtsBucket;
    if (!bucketName) {
      this.loggingService.warn(
        { event: "google_tts.missing_bucket" },
        GoogleTtsService.name,
      );
      return null;
    }
    const bucket = this.storage.bucket(bucketName);
    const file = bucket.file(objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      return null;
    }
    const ttlMs = this.config.googleTtsSignedUrlTtlSec * 1000;
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + ttlMs,
    });
    return signedUrl;
  }

  async synthesizeToObjectPath(params: {
    text: string;
    objectPath: string;
    voiceName?: string;
    languageCode?: string;
    speakingRate?: number;
    pitch?: number;
    volumeGainDb?: number;
  }): Promise<boolean> {
    if (!this.config.googleTtsEnabled) {
      return false;
    }
    const bucketName = this.config.googleTtsBucket;
    if (!bucketName) {
      this.loggingService.warn(
        { event: "google_tts.missing_bucket" },
        GoogleTtsService.name,
      );
      return false;
    }
    const trimmedText = params.text.trim();
    if (!trimmedText) {
      return false;
    }
    const bucket = this.storage.bucket(bucketName);
    const file = bucket.file(params.objectPath);
    const [exists] = await file.exists();
    if (exists) {
      return true;
    }

    const safeText =
      trimmedText.length > MAX_TTS_CHARS
        ? trimmedText.slice(0, MAX_TTS_CHARS)
        : trimmedText;
    const audioEncoding =
      AUDIO_ENCODING_MAP[this.config.googleTtsAudioEncoding] ??
      protos.google.cloud.texttospeech.v1.AudioEncoding.MP3;
    const voiceParams: protos.google.cloud.texttospeech.v1.IVoiceSelectionParams =
      {
        languageCode: params.languageCode ?? this.config.googleTtsLanguageCode,
        name: params.voiceName ?? this.config.googleTtsVoiceName,
      };
    const audioConfig: protos.google.cloud.texttospeech.v1.IAudioConfig = {
      audioEncoding,
      speakingRate: params.speakingRate ?? this.config.googleTtsSpeakingRate,
      pitch: params.pitch ?? this.config.googleTtsPitch,
      volumeGainDb: params.volumeGainDb ?? this.config.googleTtsVolumeGainDb,
    };
    const contentType =
      AUDIO_CONTENT_TYPE_MAP[this.config.googleTtsAudioEncoding] ??
      "audio/mpeg";

    try {
      const [response] = await this.ttsClient.synthesizeSpeech({
        input: { text: safeText },
        voice: voiceParams,
        audioConfig,
      });
      const audioContent = response.audioContent;
      if (!audioContent) {
        this.loggingService.warn(
          { event: "google_tts.empty_audio" },
          GoogleTtsService.name,
        );
        return false;
      }
      const audioBytes =
        typeof audioContent === "string"
          ? Buffer.from(audioContent, "base64")
          : Buffer.from(audioContent);
      await file.save(audioBytes, {
        resumable: false,
        validation: "md5",
        contentType,
      });
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorObject = error instanceof Error ? error : undefined;
      this.loggingService.error(
        `google_tts.failed: ${errorMessage}`,
        errorObject,
        GoogleTtsService.name,
      );
      return false;
    }
  }

  async synthesizeToSignedUrl(params: {
    text: string;
    voiceName?: string;
    languageCode?: string;
    speakingRate?: number;
    pitch?: number;
    volumeGainDb?: number;
  }): Promise<{ url: string; objectPath: string } | null> {
    if (!this.config.googleTtsEnabled) {
      return null;
    }
    const bucketName = this.config.googleTtsBucket;
    if (!bucketName) {
      this.loggingService.warn(
        { event: "google_tts.missing_bucket" },
        GoogleTtsService.name,
      );
      return null;
    }
    const trimmedText = params.text.trim();
    if (!trimmedText) {
      return null;
    }

    const safeText =
      trimmedText.length > MAX_TTS_CHARS
        ? trimmedText.slice(0, MAX_TTS_CHARS)
        : trimmedText;
    const audioEncoding =
      AUDIO_ENCODING_MAP[this.config.googleTtsAudioEncoding] ??
      protos.google.cloud.texttospeech.v1.AudioEncoding.MP3;
    const voiceParams: protos.google.cloud.texttospeech.v1.IVoiceSelectionParams =
      {
        languageCode: params.languageCode ?? this.config.googleTtsLanguageCode,
        name: params.voiceName ?? this.config.googleTtsVoiceName,
      };
    const audioConfig: protos.google.cloud.texttospeech.v1.IAudioConfig = {
      audioEncoding,
      speakingRate: params.speakingRate ?? this.config.googleTtsSpeakingRate,
      pitch: params.pitch ?? this.config.googleTtsPitch,
      volumeGainDb: params.volumeGainDb ?? this.config.googleTtsVolumeGainDb,
    };

    try {
      const [response] = await this.ttsClient.synthesizeSpeech({
        input: { text: safeText },
        voice: voiceParams,
        audioConfig,
      });
      const audioContent = response.audioContent;
      if (!audioContent) {
        this.loggingService.warn(
          { event: "google_tts.empty_audio" },
          GoogleTtsService.name,
        );
        return null;
      }
      const audioBytes =
        typeof audioContent === "string"
          ? Buffer.from(audioContent, "base64")
          : Buffer.from(audioContent);
      const extension =
        AUDIO_EXTENSION_MAP[this.config.googleTtsAudioEncoding] ?? "mp3";
      const contentType =
        AUDIO_CONTENT_TYPE_MAP[this.config.googleTtsAudioEncoding] ??
        "audio/mpeg";
      const objectPath = `tts/${Date.now()}-${randomUUID()}.${extension}`;
      const bucket = this.storage.bucket(bucketName);
      const file = bucket.file(objectPath);

      await file.save(audioBytes, {
        resumable: false,
        validation: "md5",
        contentType,
      });
      const ttlMs = this.config.googleTtsSignedUrlTtlSec * 1000;
      const [signedUrl] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + ttlMs,
      });

      return { url: signedUrl, objectPath };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorObject = error instanceof Error ? error : undefined;
      this.loggingService.error(
        `google_tts.failed: ${errorMessage}`,
        errorObject,
        GoogleTtsService.name,
      );
      return null;
    }
  }
}
