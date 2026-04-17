import type { Request, Response } from "express";
import type { AppConfig } from "../../config/app.config";
import { VoiceInboundUseCase } from "../voice-inbound.use-case";
import { VOICE_STREAM_PATH } from "../voice-streaming.utils";

const buildConfig = (overrides: Partial<AppConfig> = {}): AppConfig =>
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

describe("VoiceInboundUseCase provider selection", () => {
  const tenant = {
    id: "tenant-1",
    name: "Leizurely HVAC",
  };

  let tenantsService: {
    resolveTenantByPhone: jest.Mock;
    getActiveTenantSubscription: jest.Mock;
  };
  let conversationsService: {
    ensureVoiceConsentConversation: jest.Mock;
    findVoiceConversationTenantByCallSid: jest.Mock;
  };
  let conversationLifecycleService: {
    ensureVoiceConsentConversation: jest.Mock;
    findVoiceConversationTenantByCallSid: jest.Mock;
  };
  let voiceWebhookParser: {
    extractToNumber: jest.Mock;
    extractCallSid: jest.Mock;
    getRequestId: jest.Mock;
    extractFromNumber: jest.Mock;
  };
  let voiceTurnService: {
    handleTurn: jest.Mock;
  };
  let voiceResponse: {
    replyWithNoHandoff: jest.Mock;
    replyWithHumanFallback: jest.Mock;
    replyWithTwiml: jest.Mock;
  };
  let voiceConsentAudioService: {
    getCachedConsentUrl: jest.Mock;
    synthesizeAndGetUrl: jest.Mock;
  };
  let voicePromptComposer: {
    disabledTwiml: jest.Mock;
    buildConsentMessage: jest.Mock;
    buildConsentTwiml: jest.Mock;
  };
  let voiceTurnPolicy: {
    getTenantDisplayName: jest.Mock;
  };
  let loggingService: {
    log: jest.Mock;
    warn: jest.Mock;
  };

  beforeEach(() => {
    tenantsService = {
      resolveTenantByPhone: jest.fn().mockResolvedValue(tenant),
      getActiveTenantSubscription: jest.fn().mockResolvedValue({
        id: "sub-1",
        status: "ACTIVE",
      }),
    };
    conversationsService = {
      ensureVoiceConsentConversation: jest
        .fn()
        .mockResolvedValue({ id: "conversation-1" }),
      findVoiceConversationTenantByCallSid: jest.fn().mockResolvedValue(null),
    };
    conversationLifecycleService = {
      ensureVoiceConsentConversation:
        conversationsService.ensureVoiceConsentConversation,
      findVoiceConversationTenantByCallSid:
        conversationsService.findVoiceConversationTenantByCallSid,
    };
    voiceWebhookParser = {
      extractToNumber: jest.fn().mockReturnValue("+12167448929"),
      extractCallSid: jest.fn().mockReturnValue("CA123"),
      getRequestId: jest.fn().mockReturnValue("req-1"),
      extractFromNumber: jest.fn().mockReturnValue("+12165550000"),
    };
    voiceTurnService = {
      handleTurn: jest.fn(),
    };
    voiceResponse = {
      replyWithNoHandoff: jest.fn(),
      replyWithHumanFallback: jest.fn(),
      replyWithTwiml: jest.fn().mockReturnValue(undefined),
    };
    voiceConsentAudioService = {
      getCachedConsentUrl: jest
        .fn()
        .mockResolvedValue("https://media.example/consent.mp3"),
      synthesizeAndGetUrl: jest.fn().mockResolvedValue(null),
    };
    voicePromptComposer = {
      disabledTwiml: jest.fn(),
      buildConsentMessage: jest
        .fn()
        .mockReturnValue("Thank you for calling Leizurely HVAC."),
      buildConsentTwiml: jest
        .fn()
        .mockReturnValue("<Response><Say>Fallback consent.</Say></Response>"),
    };
    voiceTurnPolicy = {
      getTenantDisplayName: jest.fn().mockReturnValue("Leizurely HVAC"),
    };
    loggingService = {
      log: jest.fn(),
      warn: jest.fn(),
    };
  });

  it("uses streaming TwiML when Google STT is selected and enabled", async () => {
    const useCase = new VoiceInboundUseCase(
      buildConfig({
        voiceStreamingEnabled: true,
        voiceSttProvider: "google",
        googleSpeechEnabled: true,
      }),
      tenantsService as never,
      conversationLifecycleService as never,
      voiceWebhookParser as never,
      voiceTurnService as never,
      voiceConsentAudioService as never,
      voicePromptComposer as never,
      voiceTurnPolicy as never,
      voiceResponse as never,
      loggingService as never,
    );

    await useCase.handleInbound({} as Request, {} as Response);

    expect(
      conversationsService.ensureVoiceConsentConversation,
    ).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      callSid: "CA123",
      requestId: "req-1",
      callerPhone: "+12165550000",
    });
    expect(voiceConsentAudioService.getCachedConsentUrl).toHaveBeenCalledWith(
      "tenant-1",
      "Thank you for calling Leizurely HVAC.",
    );
    expect(voicePromptComposer.buildConsentTwiml).not.toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.streaming_inbound_selected",
        tenantId: "tenant-1",
        callSid: "CA123",
      }),
      VoiceInboundUseCase.name,
    );
    const twiml = voiceResponse.replyWithTwiml.mock.calls[0]?.[1] as string;
    expect(twiml).toContain(
      `<Start><Stream url="wss://example.ngrok.io${VOICE_STREAM_PATH}"`,
    );
    expect(twiml).toContain("<Play>https://media.example/consent.mp3</Play>");
    expect(twiml).not.toContain("<Say>");
  });

  it("falls back to standard consent TwiML when non-Google STT provider is selected", async () => {
    const useCase = new VoiceInboundUseCase(
      buildConfig({
        voiceStreamingEnabled: true,
        voiceSttProvider: "twilio",
        googleSpeechEnabled: true,
      }),
      tenantsService as never,
      conversationLifecycleService as never,
      voiceWebhookParser as never,
      voiceTurnService as never,
      voiceConsentAudioService as never,
      voicePromptComposer as never,
      voiceTurnPolicy as never,
      voiceResponse as never,
      loggingService as never,
    );

    await useCase.handleInbound({} as Request, {} as Response);

    expect(voicePromptComposer.buildConsentTwiml).toHaveBeenCalledWith(
      "Leizurely HVAC",
    );
    expect(voiceConsentAudioService.getCachedConsentUrl).not.toHaveBeenCalled();
    expect(voiceResponse.replyWithTwiml).toHaveBeenCalledWith(
      expect.anything(),
      "<Response><Say>Fallback consent.</Say></Response>",
    );
  });

  it("fails closed when inbound callSid maps to a different tenant", async () => {
    conversationsService.findVoiceConversationTenantByCallSid.mockResolvedValue({
      id: "conversation-foreign",
      tenantId: "tenant-foreign",
    });
    const useCase = new VoiceInboundUseCase(
      buildConfig(),
      tenantsService as never,
      conversationLifecycleService as never,
      voiceWebhookParser as never,
      voiceTurnService as never,
      voiceConsentAudioService as never,
      voicePromptComposer as never,
      voiceTurnPolicy as never,
      voiceResponse as never,
      loggingService as never,
    );

    await useCase.handleInbound({} as Request, {} as Response);

    expect(
      conversationsService.ensureVoiceConsentConversation,
    ).not.toHaveBeenCalled();
    expect(voiceResponse.replyWithNoHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        callSid: "CA123",
        reason: "tenant_isolation_mismatch",
      }),
    );
    expect(loggingService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.tenant_isolation_mismatch",
        callSid: "CA123",
        resolvedTenantId: "tenant-1",
        conversationTenantId: "tenant-foreign",
      }),
      VoiceInboundUseCase.name,
    );
  });

  it("fails closed on turn when callSid maps to a different tenant", async () => {
    conversationsService.findVoiceConversationTenantByCallSid.mockResolvedValue({
      id: "conversation-foreign",
      tenantId: "tenant-foreign",
    });
    voiceTurnService.handleTurn.mockResolvedValue(undefined);
    const useCase = new VoiceInboundUseCase(
      buildConfig(),
      tenantsService as never,
      conversationLifecycleService as never,
      voiceWebhookParser as never,
      voiceTurnService as never,
      voiceConsentAudioService as never,
      voicePromptComposer as never,
      voiceTurnPolicy as never,
      voiceResponse as never,
      loggingService as never,
    );

    await useCase.handleTurn({} as Request, {} as Response);

    expect(voiceTurnService.handleTurn).not.toHaveBeenCalled();
    expect(voiceResponse.replyWithNoHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        callSid: "CA123",
        reason: "tenant_isolation_mismatch",
      }),
    );
  });
});
