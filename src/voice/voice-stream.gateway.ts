import { Inject } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from "@nestjs/websockets";
import { protos } from "@google-cloud/speech";
import type { RawData, WebSocket } from "ws";
import appConfig, { type AppConfig } from "../config/app.config";
import { LoggingService } from "../logging/logging.service";
import { GoogleSpeechService } from "../google/google-speech.service";
import { GoogleTtsService } from "../google/google-tts.service";
import { ConversationsService } from "../conversations/conversations.service";
import { VoiceCallService } from "./voice-call.service";
import { VoiceTurnService } from "./voice-turn.service";
import {
  buildStreamUrl,
  buildStreamingTwiml,
  extractSayMessages,
  hasHangup,
  VOICE_STREAM_PATH,
} from "./voice-streaming.utils";
import { runWithRequestContext } from "../common/context/request-context";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import type { TenantOrganization } from "@prisma/client";

type TwilioStreamStart = {
  event: "start";
  start: {
    callSid: string;
    streamSid: string;
    customParameters?: Record<string, string>;
  };
};

type TwilioStreamMedia = {
  event: "media";
  media: {
    payload: string;
  };
};

type TwilioStreamStop = {
  event: "stop";
  stop: {
    callSid?: string;
    streamSid?: string;
  };
};

type TwilioStreamMessage =
  | TwilioStreamStart
  | TwilioStreamMedia
  | TwilioStreamStop;

type VoiceStreamSession = {
  callSid: string;
  streamSid: string;
  tenantId: string;
  tenant: TenantOrganization;
  leadId?: string;
  streamUrl: string;
  speechStream: NodeJS.ReadWriteStream;
  processing: boolean;
  lastTranscript?: string;
  lastTranscriptAt?: number;
  lastResponseText?: string;
  lastResponseAt?: number;
  closed: boolean;
};

@WebSocketGateway({ path: VOICE_STREAM_PATH })
export class VoiceStreamGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly sessions = new Map<WebSocket, VoiceStreamSession>();
  private readonly callSessions = new Map<string, WebSocket>();
  private readonly lastResponseByCall = new Map<
    string,
    { text: string; at: number }
  >();

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    private readonly conversationsService: ConversationsService,
    private readonly googleSpeechService: GoogleSpeechService,
    private readonly googleTtsService: GoogleTtsService,
    private readonly voiceCallService: VoiceCallService,
    private readonly voiceTurnService: VoiceTurnService,
    private readonly loggingService: LoggingService,
  ) {}

  handleConnection(client: WebSocket) {
    client.on("message", (data: RawData) => {
      void this.handleMessage(client, data);
    });
  }

  handleDisconnect(client: WebSocket) {
    this.cleanupSession(client);
  }

  private async handleMessage(client: WebSocket, data: RawData) {
    const message = this.parseMessage(data);
    if (!message) {
      return;
    }
    switch (message.event) {
      case "start":
        await this.handleStart(client, message);
        return;
      case "media":
        this.handleMedia(client, message);
        return;
      case "stop":
        this.handleStop(client, message);
        return;
      default:
        return;
    }
  }

  private parseMessage(data: RawData): TwilioStreamMessage | null {
    const text = this.rawDataToString(data);
    try {
      return JSON.parse(text) as TwilioStreamMessage;
    } catch (error) {
      this.loggingService.warn(
        {
          event: "voice.stream.invalid_message",
          payload: text,
          reason: error instanceof Error ? error.message : String(error),
        },
        VoiceStreamGateway.name,
      );
      return null;
    }
  }

  private rawDataToString(data: RawData): string {
    if (typeof data === "string") {
      return data;
    }
    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data).toString("utf8");
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString("utf8");
    }
    return "";
  }

  private async handleStart(client: WebSocket, message: TwilioStreamStart) {
    if (!this.config.voiceStreamingEnabled) {
      client.close();
      return;
    }
    if (!this.googleSpeechService.isEnabled()) {
      this.loggingService.warn(
        { event: "voice.stream.speech_disabled" },
        VoiceStreamGateway.name,
      );
      client.close();
      return;
    }
    if (!this.config.twilioWebhookBaseUrl) {
      this.loggingService.warn(
        { event: "voice.stream.missing_base_url" },
        VoiceStreamGateway.name,
      );
      client.close();
      return;
    }

    const callSid = message.start.callSid;
    const streamSid = message.start.streamSid;
    if (!callSid || !streamSid) {
      client.close();
      return;
    }
    const existingClient = this.callSessions.get(callSid);
    if (existingClient && existingClient !== client) {
      this.cleanupSession(existingClient);
      try {
        existingClient.close();
      } catch {
        // Best effort cleanup.
      }
    }

    const params = message.start.customParameters ?? {};
    const tenantId = params.tenantId ?? this.config.demoTenantId;
    if (!tenantId) {
      this.loggingService.warn(
        { event: "voice.stream.missing_tenant", callSid },
        VoiceStreamGateway.name,
      );
      client.close();
      return;
    }
    const tenant = await this.tenantsService.getTenantById(tenantId);
    if (!tenant) {
      this.loggingService.warn(
        { event: "voice.stream.tenant_not_found", callSid, tenantId },
        VoiceStreamGateway.name,
      );
      client.close();
      return;
    }

    const leadId = params.leadId;
    await this.conversationsService.ensureVoiceConsentConversation({
      tenantId: tenant.id,
      callSid,
      requestId: leadId,
    });

    const speechStream =
      this.googleSpeechService.createStreamingRecognizeStream();
    if (!speechStream) {
      client.close();
      return;
    }

    const streamUrl = buildStreamUrl(
      this.config.twilioWebhookBaseUrl,
      VOICE_STREAM_PATH,
    );
    const session: VoiceStreamSession = {
      callSid,
      streamSid,
      tenantId: tenant.id,
      tenant,
      leadId,
      streamUrl,
      speechStream,
      processing: false,
      closed: false,
    };
    this.sessions.set(client, session);
    this.callSessions.set(callSid, client);

    speechStream.on("data", (data) => {
      this.handleSpeechData(
        session,
        data as protos.google.cloud.speech.v1.IStreamingRecognizeResponse,
      );
    });
    speechStream.on("error", (error) => {
      this.loggingService.warn(
        {
          event: "voice.stream.speech_error",
          callSid,
          reason: error instanceof Error ? error.message : String(error),
        },
        VoiceStreamGateway.name,
      );
    });
  }

  private handleMedia(client: WebSocket, message: TwilioStreamMedia) {
    const session = this.sessions.get(client);
    if (!session) {
      return;
    }
    if (session.closed || !this.isWritableStream(session.speechStream)) {
      return;
    }
    const payload = message.media.payload;
    if (!payload) {
      return;
    }
    const chunk = Buffer.from(payload, "base64");
    session.speechStream.write(chunk);
  }

  private handleStop(client: WebSocket, message: TwilioStreamStop) {
    const session = this.sessions.get(client);
    if (!session) {
      return;
    }
    this.loggingService.log(
      {
        event: "voice.stream.stopped",
        callSid: message.stop.callSid ?? session.callSid,
        streamSid: message.stop.streamSid ?? session.streamSid,
      },
      VoiceStreamGateway.name,
    );
    this.cleanupSession(client);
  }

  private handleSpeechData(
    session: VoiceStreamSession,
    data: protos.google.cloud.speech.v1.IStreamingRecognizeResponse,
  ) {
    const result = data.results?.[0];
    const alternative = result?.alternatives?.[0];
    const transcript = alternative?.transcript?.trim();
    if (!transcript) {
      return;
    }
    if (!result?.isFinal) {
      return;
    }
    if (this.isFillerTranscript(transcript)) {
      return;
    }
    const now = Date.now();
    if (
      session.lastTranscript === transcript &&
      session.lastTranscriptAt &&
      now - session.lastTranscriptAt < 1500
    ) {
      return;
    }
    session.lastTranscript = transcript;
    session.lastTranscriptAt = now;
    const confidence = alternative?.confidence ?? undefined;
    void this.handleFinalTranscript(session, transcript, confidence);
  }

  private async handleFinalTranscript(
    session: VoiceStreamSession,
    transcript: string,
    confidence?: number,
  ) {
    if (session.processing) {
      return;
    }
    session.processing = true;
    try {
      const twiml = await runWithRequestContext(
        {
          tenantId: session.tenantId,
          callSid: session.callSid,
          channel: "VOICE",
          requestId: session.leadId,
        },
        () =>
          this.voiceTurnService.handleStreamingTurn({
            tenant: session.tenant,
            callSid: session.callSid,
            speechResult: transcript,
            confidence,
            requestId: session.leadId,
          }),
      );

      const messages = extractSayMessages(twiml);
      if (!messages.length) {
        return;
      }
      const sayText = messages.join(" ");
      const playUrlResult = await this.googleTtsService.synthesizeToSignedUrl({
        text: sayText,
      });
      const hangup = hasHangup(twiml);
      const now = Date.now();
      if (!hangup) {
        const lastResponse = this.lastResponseByCall.get(session.callSid);
        if (
          lastResponse &&
          lastResponse.text === sayText &&
          now - lastResponse.at < 2000
        ) {
          return;
        }
        if (
          session.lastResponseText === sayText &&
          session.lastResponseAt &&
          now - session.lastResponseAt < 2000
        ) {
          return;
        }
      }
      const responseTwiml = buildStreamingTwiml({
        streamUrl: session.streamUrl,
        streamParams: {
          tenantId: session.tenantId,
          leadId: session.leadId,
        },
        playUrl: playUrlResult?.url,
        sayText: playUrlResult?.url ? undefined : sayText,
        keepAliveSec: this.config.voiceStreamingKeepAliveSec,
        hangup,
        track: this.config.voiceStreamingTrack,
      });

      await this.voiceCallService.updateCallTwiml(
        session.callSid,
        responseTwiml,
      );
      session.lastResponseText = sayText;
      session.lastResponseAt = now;
      this.lastResponseByCall.set(session.callSid, { text: sayText, at: now });
    } finally {
      session.processing = false;
    }
  }

  private isFillerTranscript(transcript: string): boolean {
    const normalized = transcript.toLowerCase().trim();
    if (!normalized) {
      return true;
    }
    if (/\d/.test(normalized)) {
      return false;
    }
    if (normalized.length <= 2) {
      return true;
    }
    return /\b(hold on|hang on|one sec|one second|just a sec|give me a sec|wait|um|uh|hmm|thank you for calling|this call may be recorded|this call may be transcribed)\b/.test(
      normalized,
    );
  }

  private cleanupSession(client: WebSocket) {
    const session = this.sessions.get(client);
    if (session) {
      session.closed = true;
      session.speechStream.removeAllListeners();
      session.speechStream.end();
      if (this.callSessions.get(session.callSid) === client) {
        this.callSessions.delete(session.callSid);
      }
      this.sessions.delete(client);
    }
  }

  private isWritableStream(stream: NodeJS.ReadWriteStream): boolean {
    const writable = (stream as NodeJS.WritableStream).writable;
    const writableOk = typeof writable === "boolean" ? writable : true;
    const writableEndedValue = (stream as { writableEnded?: unknown })
      .writableEnded;
    const writableEnded =
      typeof writableEndedValue === "boolean" ? writableEndedValue : false;
    const destroyedValue = (stream as { destroyed?: unknown }).destroyed;
    const destroyed =
      typeof destroyedValue === "boolean" ? destroyedValue : false;
    return writableOk && !writableEnded && !destroyed;
  }
}
