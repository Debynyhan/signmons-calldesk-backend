import type { AppConfig } from "../../config/app.config";
import { VoiceConsentAudioService } from "../voice-consent-audio.service";

const buildConfig = (
  overrides: Partial<AppConfig> = {},
): AppConfig =>
  ({
    voiceTtsProvider: "google",
    googleTtsEnabled: true,
    googleTtsBucket: "bucket-1",
    googleTtsVoiceName: "en-US-Studio-O",
    googleTtsLanguageCode: "en-US",
    googleTtsAudioEncoding: "MP3",
    googleTtsSpeakingRate: 1,
    googleTtsPitch: 0,
    googleTtsVolumeGainDb: 0,
    ...overrides,
  }) as AppConfig;

describe("VoiceConsentAudioService provider selection", () => {
  let googleTtsService: {
    getSignedUrlIfExists: jest.Mock;
    synthesizeToObjectPath: jest.Mock;
    getAudioExtension: jest.Mock;
  };
  let loggingService: {
    warn: jest.Mock;
  };

  beforeEach(() => {
    googleTtsService = {
      getSignedUrlIfExists: jest.fn(),
      synthesizeToObjectPath: jest.fn(),
      getAudioExtension: jest.fn().mockReturnValue("mp3"),
    };
    loggingService = {
      warn: jest.fn(),
    };
  });

  it("returns null and skips lookup when TTS provider is not Google", async () => {
    const service = new VoiceConsentAudioService(
      buildConfig({ voiceTtsProvider: "twilio" }),
      googleTtsService as never,
      loggingService as never,
    );

    const result = await service.getCachedConsentUrl("tenant-1", "Consent copy");

    expect(result).toBeNull();
    expect(googleTtsService.getSignedUrlIfExists).not.toHaveBeenCalled();
  });

  it("looks up a signed URL when Google TTS is selected", async () => {
    googleTtsService.getSignedUrlIfExists.mockResolvedValue(
      "https://media.example/consent.mp3",
    );
    const service = new VoiceConsentAudioService(
      buildConfig({
        voiceTtsProvider: "google",
        googleTtsEnabled: true,
        googleTtsBucket: "bucket-1",
      }),
      googleTtsService as never,
      loggingService as never,
    );

    const result = await service.getCachedConsentUrl("tenant-1", "Consent copy");

    expect(result).toBe("https://media.example/consent.mp3");
    expect(googleTtsService.getSignedUrlIfExists).toHaveBeenCalledWith(
      expect.stringMatching(/^tts\/consent\/tenant-1\/[a-f0-9]{16}\.mp3$/),
    );
  });

  it("does not synthesize when Google TTS provider is disabled", () => {
    const service = new VoiceConsentAudioService(
      buildConfig({ voiceTtsProvider: "twilio" }),
      googleTtsService as never,
      loggingService as never,
    );

    service.warmConsentAudio("tenant-1", "Consent copy");

    expect(googleTtsService.synthesizeToObjectPath).not.toHaveBeenCalled();
  });

  it("deduplicates in-flight synthesis for the same consent audio", async () => {
    let resolve: ((value: boolean) => void) | undefined;
    const pending = new Promise<boolean>((complete) => {
      resolve = complete;
    });
    googleTtsService.synthesizeToObjectPath.mockReturnValue(pending);
    const service = new VoiceConsentAudioService(
      buildConfig(),
      googleTtsService as never,
      loggingService as never,
    );

    service.warmConsentAudio("tenant-1", "Consent copy");
    service.warmConsentAudio("tenant-1", "Consent copy");

    expect(googleTtsService.synthesizeToObjectPath).toHaveBeenCalledTimes(1);
    resolve?.(true);
    await pending;
  });
});
