import type { RawData } from "ws";
import { LoggingService } from "../logging/logging.service";

export type TwilioStreamStart = {
  event: "start";
  start: {
    callSid: string;
    streamSid: string;
    customParameters?: Record<string, string>;
  };
};

export type TwilioStreamMedia = {
  event: "media";
  media: {
    payload: string;
  };
};

export type TwilioStreamStop = {
  event: "stop";
  stop: {
    callSid?: string;
    streamSid?: string;
  };
};

export type TwilioStreamMessage =
  | TwilioStreamStart
  | TwilioStreamMedia
  | TwilioStreamStop;

export class VoiceStreamTransportRuntime {
  private static readonly LOG_SOURCE = "VoiceStreamGateway";

  constructor(private readonly loggingService: LoggingService) {}

  parseMessage(data: RawData): TwilioStreamMessage | null {
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
        VoiceStreamTransportRuntime.LOG_SOURCE,
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
}
