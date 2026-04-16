import { SmsController } from "../../../sms/sms.controller";
import { VoiceController } from "../../../voice/voice.controller";
import { TWILIO_WEBHOOK_THROTTLE } from "../twilio-webhook-throttle";

const THROTTLER_LIMIT_DEFAULT_KEY = "THROTTLER:LIMITdefault";
const THROTTLER_TTL_DEFAULT_KEY = "THROTTLER:TTLdefault";

describe("Twilio webhook throttle metadata", () => {
  it("applies elevated throttle limits to Twilio webhook endpoints", () => {
    expect(
      Reflect.getMetadata(
        THROTTLER_LIMIT_DEFAULT_KEY,
        VoiceController.prototype.handleInbound,
      ),
    ).toBe(TWILIO_WEBHOOK_THROTTLE.default.limit);
    expect(
      Reflect.getMetadata(
        THROTTLER_TTL_DEFAULT_KEY,
        VoiceController.prototype.handleInbound,
      ),
    ).toBe(TWILIO_WEBHOOK_THROTTLE.default.ttl);
    expect(
      Reflect.getMetadata(
        THROTTLER_LIMIT_DEFAULT_KEY,
        VoiceController.prototype.handleTurn,
      ),
    ).toBe(TWILIO_WEBHOOK_THROTTLE.default.limit);
    expect(
      Reflect.getMetadata(
        THROTTLER_LIMIT_DEFAULT_KEY,
        SmsController.prototype.handleInbound,
      ),
    ).toBe(TWILIO_WEBHOOK_THROTTLE.default.limit);
  });

  it("keeps non-webhook endpoints on module defaults", () => {
    expect(
      Reflect.getMetadata(
        THROTTLER_LIMIT_DEFAULT_KEY,
        VoiceController.prototype.handleStatus,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        THROTTLER_LIMIT_DEFAULT_KEY,
        SmsController.prototype.confirmField,
      ),
    ).toBeUndefined();
  });
});
