import type { Request, Response } from "express";
import type { AppConfig } from "../../config/app.config";
import { VoiceController } from "../voice.controller";
import { VOICE_STREAM_PATH } from "../voice-streaming.utils";

const buildConfig = (
  overrides: Partial<AppConfig> = {},
): AppConfig =>
  ({
    environment: "development",
    voiceEnabled: true,
    voiceStreamingEnabled: true,
    voiceSttProvider: "google",
    googleSpeechEnabled: true,
    twilioWebhookBaseUrl: "https://example.ngrok.io",
    voiceStreamingKeepAliveSec: 60,
    voiceStreamingTrack: "inbound",
    twilioSignatureCheck: false,
    twilioAuthToken: "secret",
    ...overrides,
  }) as AppConfig;

describe("VoiceController provider selection", () => {
  const tenant = {
    id: "tenant-1",
    name: "Leizurely HVAC",
  };

  let tenantsService: {
    resolveTenantByPhone: jest.Mock;
  };
  let conversationsService: {
    ensureVoiceConsentConversation: jest.Mock;
  };
  let voiceTurnService: {
    replyWithNoHandoff: jest.Mock;
    disabledTwiml: jest.Mock;
    extractToNumber: jest.Mock;
    getTenantDisplayName: jest.Mock;
    extractCallSid: jest.Mock;
    getRequestId: jest.Mock;
    extractFromNumber: jest.Mock;
    buildConsentMessage: jest.Mock;
    buildConsentTwiml: jest.Mock;
    replyWithTwiml: jest.Mock;
  };
  let voiceConsentAudioService: {
    getCachedConsentUrl: jest.Mock;
    warmConsentAudio: jest.Mock;
  };
  let loggingService: {
    log: jest.Mock;
    warn: jest.Mock;
  };

  beforeEach(() => {
    tenantsService = {
      resolveTenantByPhone: jest.fn().mockResolvedValue(tenant),
    };
    conversationsService = {
      ensureVoiceConsentConversation: jest
        .fn()
        .mockResolvedValue({ id: "conversation-1" }),
    };
    voiceTurnService = {
      replyWithNoHandoff: jest.fn(),
      disabledTwiml: jest.fn(),
      extractToNumber: jest.fn().mockReturnValue("+12167448929"),
      getTenantDisplayName: jest.fn().mockReturnValue("Leizurely HVAC"),
      extractCallSid: jest.fn().mockReturnValue("CA123"),
      getRequestId: jest.fn().mockReturnValue("req-1"),
      extractFromNumber: jest.fn().mockReturnValue("+12165550000"),
      buildConsentMessage: jest
        .fn()
        .mockReturnValue("Thank you for calling Leizurely HVAC."),
      buildConsentTwiml: jest
        .fn()
        .mockReturnValue("<Response><Say>Fallback consent.</Say></Response>"),
      replyWithTwiml: jest.fn().mockReturnValue(undefined),
    };
    voiceConsentAudioService = {
      getCachedConsentUrl: jest
        .fn()
        .mockResolvedValue("https://media.example/consent.mp3"),
      warmConsentAudio: jest.fn(),
    };
    loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
    };
  });

  it("uses streaming TwiML when Google STT is selected and enabled", async () => {
    const controller = new VoiceController(
      buildConfig({
        voiceStreamingEnabled: true,
        voiceSttProvider: "google",
        googleSpeechEnabled: true,
      }),
      tenantsService as never,
      conversationsService as never,
      voiceTurnService as never,
      voiceConsentAudioService as never,
      loggingService as never,
    );

    await controller.handleInbound({} as Request, {} as Response);

    expect(conversationsService.ensureVoiceConsentConversation).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      callSid: "CA123",
      requestId: "req-1",
      callerPhone: "+12165550000",
    });
    expect(voiceConsentAudioService.getCachedConsentUrl).toHaveBeenCalledWith(
      "tenant-1",
      "Thank you for calling Leizurely HVAC.",
    );
    expect(voiceConsentAudioService.warmConsentAudio).not.toHaveBeenCalled();
    expect(voiceTurnService.buildConsentTwiml).not.toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.streaming_inbound_selected",
        tenantId: "tenant-1",
        callSid: "CA123",
      }),
      VoiceController.name,
    );
    const twiml = voiceTurnService.replyWithTwiml.mock.calls[0]?.[1] as string;
    expect(twiml).toContain(
      `<Start><Stream url="wss://example.ngrok.io${VOICE_STREAM_PATH}"`,
    );
    expect(twiml).toContain("<Play>https://media.example/consent.mp3</Play>");
    expect(twiml).not.toContain("<Say>");
  });

  it("falls back to standard consent TwiML when non-Google STT provider is selected", async () => {
    const controller = new VoiceController(
      buildConfig({
        voiceStreamingEnabled: true,
        voiceSttProvider: "twilio",
        googleSpeechEnabled: true,
      }),
      tenantsService as never,
      conversationsService as never,
      voiceTurnService as never,
      voiceConsentAudioService as never,
      loggingService as never,
    );

    await controller.handleInbound({} as Request, {} as Response);

    expect(voiceTurnService.buildConsentTwiml).toHaveBeenCalledWith(
      "Leizurely HVAC",
    );
    expect(voiceConsentAudioService.getCachedConsentUrl).not.toHaveBeenCalled();
    expect(voiceConsentAudioService.warmConsentAudio).not.toHaveBeenCalled();
    expect(voiceTurnService.replyWithTwiml).toHaveBeenCalledWith(
      expect.anything(),
      "<Response><Say>Fallback consent.</Say></Response>",
    );
  });
});
