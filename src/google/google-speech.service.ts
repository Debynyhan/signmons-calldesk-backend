import { Injectable, Inject } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { SpeechClient, protos } from "@google-cloud/speech";
import appConfig from "../config/app.config";
import { LoggingService } from "../logging/logging.service";

const SPEECH_ENCODING_MAP: Record<
  "MULAW" | "LINEAR16" | "OGG_OPUS",
  protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding
> = {
  MULAW: protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.MULAW,
  LINEAR16:
    protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.LINEAR16,
  OGG_OPUS:
    protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.OGG_OPUS,
};

@Injectable()
export class GoogleSpeechService {
  private readonly speechClient = new SpeechClient();

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly loggingService: LoggingService,
  ) {}

  isEnabled(): boolean {
    return this.config.googleSpeechEnabled;
  }

  buildStreamingRecognizeConfig(): protos.google.cloud.speech.v1.IStreamingRecognitionConfig | null {
    if (!this.config.googleSpeechEnabled) {
      return null;
    }
    const encoding =
      SPEECH_ENCODING_MAP[this.config.googleSpeechEncoding] ??
      protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.MULAW;
    return {
      config: {
        encoding,
        sampleRateHertz: this.config.googleSpeechSampleRateHz,
        languageCode: this.config.googleSpeechLanguageCode,
        model: this.config.googleSpeechModel || undefined,
        useEnhanced: this.config.googleSpeechUseEnhanced,
        enableAutomaticPunctuation: true,
      },
      interimResults: this.config.googleSpeechInterimResults,
    };
  }

  createStreamingRecognizeStream(): NodeJS.ReadWriteStream | null {
    const config = this.buildStreamingRecognizeConfig();
    if (!config) {
      this.loggingService.warn(
        { event: "google_speech.disabled" },
        GoogleSpeechService.name,
      );
      return null;
    }
    return this.speechClient.streamingRecognize(
      config,
    ) as unknown as NodeJS.ReadWriteStream;
  }
}
