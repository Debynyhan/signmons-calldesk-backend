import {
  extractVoiceSmsPhoneCandidate,
  getVoiceCallerPhoneFromCollectedData,
  isVoiceSmsNumberConfirmation,
} from "../voice-sms-phone-confirmation.policy";

describe("voice-sms-phone-confirmation.policy", () => {
  it("detects same-number confirmations", () => {
    expect(isVoiceSmsNumberConfirmation("yes")).toBe(true);
    expect(isVoiceSmsNumberConfirmation("use this number")).toBe(true);
    expect(isVoiceSmsNumberConfirmation("that number works")).toBe(true);
    expect(isVoiceSmsNumberConfirmation("not that one")).toBe(false);
  });

  it("extracts sms phone candidate via sanitizer callback", () => {
    const normalizePhoneE164 = (value: string) =>
      value.includes("216") ? "+12165551234" : "";

    expect(
      extractVoiceSmsPhoneCandidate("my number is 216-555-1234", normalizePhoneE164),
    ).toBe("+12165551234");
    expect(extractVoiceSmsPhoneCandidate("no number here", normalizePhoneE164)).toBe(
      null,
    );
  });

  it("reads caller phone from collected data safely", () => {
    expect(getVoiceCallerPhoneFromCollectedData(null)).toBe(null);
    expect(
      getVoiceCallerPhoneFromCollectedData({
        callerPhone: "+12165551234",
      } as unknown as Record<string, unknown>),
    ).toBe("+12165551234");
    expect(
      getVoiceCallerPhoneFromCollectedData({
        callerPhone: 1234,
      } as unknown as Record<string, unknown>),
    ).toBe(null);
  });
});
