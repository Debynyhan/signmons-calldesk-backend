import { PassThrough } from "stream";
import type { WebSocket } from "ws";
import type { AppConfig } from "../../config/app.config";
import { VOICE_STREAM_PATH } from "../voice-streaming.utils";
import { VoiceStreamGateway } from "../voice-stream.gateway";

const buildConfig = (
  overrides: Partial<AppConfig> = {},
): AppConfig =>
  ({
    voiceStreamingEnabled: true,
    voiceSttProvider: "google",
    voiceTtsProvider: "google",
    twilioWebhookBaseUrl: "https://example.ngrok.io",
    voiceStreamingKeepAliveSec: 45,
    voiceStreamingTrack: "inbound",
    demoTenantId: "",
    ...overrides,
  }) as AppConfig;

describe("VoiceStreamGateway provider selection", () => {
  let tenantsService: {
    getTenantById: jest.Mock;
  };
  let conversationsService: {
    ensureVoiceConsentConversation: jest.Mock;
  };
  let googleSpeechService: {
    isEnabled: jest.Mock;
    createStreamingRecognizeStream: jest.Mock;
  };
  let googleTtsService: {
    isEnabled: jest.Mock;
    synthesizeToSignedUrl: jest.Mock;
  };
  let voiceCallService: {
    updateCallTwiml: jest.Mock;
  };
  let voiceTurnService: {
    handleStreamingTurn: jest.Mock;
  };
  let loggingService: {
    log: jest.Mock;
    warn: jest.Mock;
  };

  beforeEach(() => {
    tenantsService = {
      getTenantById: jest.fn(),
    };
    conversationsService = {
      ensureVoiceConsentConversation: jest.fn(),
    };
    googleSpeechService = {
      isEnabled: jest.fn().mockReturnValue(true),
      createStreamingRecognizeStream: jest.fn(),
    };
    googleTtsService = {
      isEnabled: jest.fn().mockReturnValue(true),
      synthesizeToSignedUrl: jest
        .fn()
        .mockResolvedValue({ url: "https://audio.example/reply.mp3" }),
    };
    voiceCallService = {
      updateCallTwiml: jest.fn().mockResolvedValue(true),
    };
    voiceTurnService = {
      handleStreamingTurn: jest.fn().mockResolvedValue(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thanks for calling.</Say></Response>',
      ),
    };
    loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
    };
  });

  it("closes the socket when STT provider is not Google", async () => {
    const gateway = new VoiceStreamGateway(
      buildConfig({
        voiceStreamingEnabled: true,
        voiceSttProvider: "twilio",
      }),
      tenantsService as never,
      conversationsService as never,
      googleSpeechService as never,
      googleTtsService as never,
      voiceCallService as never,
      voiceTurnService as never,
      loggingService as never,
    );

    const client = {
      close: jest.fn(),
    } as unknown as WebSocket;

    await (gateway as any).handleStart(client, {
      event: "start",
      start: {
        callSid: "CA123",
        streamSid: "MZ123",
      },
    });

    expect(loggingService.warn).toHaveBeenCalledWith(
      { event: "voice.stream.stt_provider_disabled" },
      VoiceStreamGateway.name,
    );
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(googleSpeechService.isEnabled).not.toHaveBeenCalled();
  });

  it("uses Google TTS playback when the Google TTS provider is selected", async () => {
    const gateway = new VoiceStreamGateway(
      buildConfig({
        voiceTtsProvider: "google",
      }),
      tenantsService as never,
      conversationsService as never,
      googleSpeechService as never,
      googleTtsService as never,
      voiceCallService as never,
      voiceTurnService as never,
      loggingService as never,
    );
    const session = {
      callSid: "CA123",
      streamSid: "MZ123",
      tenantId: "tenant-1",
      tenant: { id: "tenant-1" },
      leadId: "lead-1",
      streamUrl: `wss://example.ngrok.io${VOICE_STREAM_PATH}`,
      speechStream: new PassThrough(),
      processing: false,
      closed: false,
    };

    await (gateway as any).handleFinalTranscript(session, "no heat", 0.91);

    expect(googleTtsService.synthesizeToSignedUrl).toHaveBeenCalledWith({
      text: "Thanks for calling.",
    });
    const twiml = voiceCallService.updateCallTwiml.mock.calls[0]?.[1] as string;
    expect(twiml).toContain("<Play>https://audio.example/reply.mp3</Play>");
    expect(twiml).not.toContain("<Say>Thanks for calling.</Say>");
  });

  it("uses <Say> when TTS provider is not Google", async () => {
    const gateway = new VoiceStreamGateway(
      buildConfig({
        voiceTtsProvider: "twilio",
      }),
      tenantsService as never,
      conversationsService as never,
      googleSpeechService as never,
      googleTtsService as never,
      voiceCallService as never,
      voiceTurnService as never,
      loggingService as never,
    );
    const session = {
      callSid: "CA123",
      streamSid: "MZ123",
      tenantId: "tenant-1",
      tenant: { id: "tenant-1" },
      streamUrl: `wss://example.ngrok.io${VOICE_STREAM_PATH}`,
      speechStream: new PassThrough(),
      processing: false,
      closed: false,
    };

    await (gateway as any).handleFinalTranscript(session, "no heat", 0.91);

    expect(googleTtsService.synthesizeToSignedUrl).not.toHaveBeenCalled();
    const twiml = voiceCallService.updateCallTwiml.mock.calls[0]?.[1] as string;
    expect(twiml).toContain("<Say>Thanks for calling.</Say>");
  });
});
