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
    voiceTtsShortSayMaxChars: 0,
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
    getAudioExtension: jest.Mock;
    synthesizeToObjectPath: jest.Mock;
    getSignedUrlIfExists: jest.Mock;
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
      getAudioExtension: jest.fn().mockReturnValue("mp3"),
      synthesizeToObjectPath: jest.fn().mockResolvedValue(true),
      getSignedUrlIfExists: jest
        .fn()
        .mockResolvedValue("https://audio.example/reply.mp3"),
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
    const longReply =
      "Thanks for calling. We can absolutely help with that issue today and I will get a technician to your address shortly.";
    voiceTurnService.handleStreamingTurn.mockResolvedValueOnce(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${longReply}</Say></Response>`,
    );
    const gateway = new VoiceStreamGateway(
      buildConfig({
        voiceTtsProvider: "google",
        voiceTtsShortSayMaxChars: 80,
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
      startedAtMs: Date.now(),
      closed: false,
    };

    await (gateway as any).handleFinalTranscript(session, "no heat", 0.91);

    expect(googleTtsService.synthesizeToObjectPath).toHaveBeenCalledWith(
      expect.objectContaining({
        text: longReply,
        objectPath: expect.stringMatching(/^tts\/cache\/[a-f0-9]{64}\.mp3$/),
      }),
    );
    expect(googleTtsService.getSignedUrlIfExists).toHaveBeenCalledTimes(1);
    const twiml = voiceCallService.updateCallTwiml.mock.calls[0]?.[1] as string;
    expect(twiml).toContain("<Play>https://audio.example/reply.mp3</Play>");
    expect(twiml).not.toContain("<Say>");
  });

  it("uses <Say> for short prompts even when Google TTS provider is selected", async () => {
    voiceTurnService.handleStreamingTurn.mockResolvedValueOnce(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thanks for calling.</Say></Response>',
    );
    const gateway = new VoiceStreamGateway(
      buildConfig({
        voiceTtsProvider: "google",
        voiceTtsShortSayMaxChars: 80,
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
      startedAtMs: Date.now(),
      closed: false,
    };

    await (gateway as any).handleFinalTranscript(session, "no heat", 0.91);

    expect(googleTtsService.synthesizeToObjectPath).not.toHaveBeenCalled();
    const twiml = voiceCallService.updateCallTwiml.mock.calls[0]?.[1] as string;
    expect(twiml).toContain("<Say>Thanks for calling.</Say>");
    expect(twiml).not.toContain("<Play>");
  });

  it("reuses cached Google TTS URLs for identical text", async () => {
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

    const text =
      "This is a longer message that should be cached for repeated playback in the same runtime process.";
    const first = await (gateway as any).getGoogleTtsPlayback(text);
    const second = await (gateway as any).getGoogleTtsPlayback(text);

    expect(first?.playback.url).toBe("https://audio.example/reply.mp3");
    expect(second?.playback.url).toBe("https://audio.example/reply.mp3");
    expect(second?.cacheHit).toBe(true);
    expect(googleTtsService.synthesizeToObjectPath).toHaveBeenCalledTimes(1);
    expect(googleTtsService.getSignedUrlIfExists).toHaveBeenCalledTimes(1);
  });

  it("queues one pending transcript while a turn is processing", async () => {
    const firstTwiml =
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>First reply.</Say></Response>';
    const secondTwiml =
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Second reply.</Say></Response>';
    let resolveFirst:
      | ((value: string | PromiseLike<string>) => void)
      | undefined;
    const firstTurn = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    voiceTurnService.handleStreamingTurn
      .mockImplementationOnce(async () => firstTurn)
      .mockResolvedValueOnce(secondTwiml);

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
      leadId: "lead-1",
      streamUrl: `wss://example.ngrok.io${VOICE_STREAM_PATH}`,
      speechStream: new PassThrough(),
      processing: false,
      startedAtMs: Date.now(),
      closed: false,
    };

    const running = (gateway as any).handleFinalTranscript(
      session,
      "first issue",
      0.9,
    );
    await Promise.resolve();
    await (gateway as any).handleFinalTranscript(session, "second issue", 0.92);

    expect(session.pendingTranscript).toEqual(
      expect.objectContaining({
        transcript: "second issue",
        confidence: 0.92,
      }),
    );

    resolveFirst?.(firstTwiml);
    await running;
    await new Promise((resolve) => setImmediate(resolve));

    expect(
      voiceTurnService.handleStreamingTurn.mock.calls.map(
        (call) => call[0]?.speechResult,
      ),
    ).toEqual(["first issue", "second issue"]);
    expect(voiceCallService.updateCallTwiml).toHaveBeenCalledTimes(2);
  });

  it("swallows late stream errors after cleanup", () => {
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
    const client = { close: jest.fn() } as unknown as WebSocket;
    const stream = new PassThrough();
    (gateway as any).sessions.set(client, {
      callSid: "CA123",
      streamSid: "MZ123",
      tenantId: "tenant-1",
      tenant: { id: "tenant-1" },
      streamUrl: `wss://example.ngrok.io${VOICE_STREAM_PATH}`,
      speechStream: stream,
      processing: false,
      startedAtMs: Date.now(),
      closed: false,
    });
    (gateway as any).callSessions.set("CA123", client);

    (gateway as any).cleanupSession(client);

    expect(() => stream.emit("error", new Error("late timeout"))).not.toThrow();
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
      startedAtMs: Date.now(),
      closed: false,
    };

    await (gateway as any).handleFinalTranscript(session, "no heat", 0.91);

    expect(googleTtsService.synthesizeToObjectPath).not.toHaveBeenCalled();
    const twiml = voiceCallService.updateCallTwiml.mock.calls[0]?.[1] as string;
    expect(twiml).toContain("<Say>Thanks for calling.</Say>");
  });
});
