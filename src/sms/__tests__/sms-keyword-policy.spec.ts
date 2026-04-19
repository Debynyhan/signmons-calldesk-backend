import {
  buildSmsKeywordReply,
  isTwilioManagedKeyword,
  resolveSmsKeywordIntent,
} from "../sms-keyword-policy";

describe("sms-keyword-policy", () => {
  it("detects opt-out keywords from body", () => {
    expect(resolveSmsKeywordIntent({ Body: "stop" })).toBe("opt_out");
    expect(resolveSmsKeywordIntent({ Body: "STOP ALL" })).toBe("opt_out");
    expect(resolveSmsKeywordIntent({ Body: "unsubscribe" })).toBe("opt_out");
  });

  it("detects opt-in and help keywords from body", () => {
    expect(resolveSmsKeywordIntent({ Body: "start" })).toBe("opt_in");
    expect(resolveSmsKeywordIntent({ Body: "YES" })).toBe("opt_in");
    expect(resolveSmsKeywordIntent({ Body: "help" })).toBe("help");
  });

  it("prefers Twilio OptOutType when present", () => {
    expect(
      resolveSmsKeywordIntent({
        Body: "hello there",
        OptOutType: "STOP",
      }),
    ).toBe("opt_out");
    expect(
      resolveSmsKeywordIntent({
        Body: "hello there",
        OptOutType: "START",
      }),
    ).toBe("opt_in");
    expect(
      resolveSmsKeywordIntent({
        Body: "hello there",
        OptOutType: "HELP",
      }),
    ).toBe("help");
  });

  it("reports Twilio-managed keyword envelope", () => {
    expect(isTwilioManagedKeyword({})).toBe(false);
    expect(isTwilioManagedKeyword({ OptOutType: "" })).toBe(false);
    expect(isTwilioManagedKeyword({ OptOutType: "STOP" })).toBe(true);
  });

  it("builds compliant keyword replies", () => {
    expect(buildSmsKeywordReply("opt_in", "Acme HVAC")).toContain("Acme HVAC");
    expect(buildSmsKeywordReply("opt_out", "Acme HVAC")).toContain("START");
    expect(buildSmsKeywordReply("help", "Acme HVAC")).toContain("STOP");
    expect(buildSmsKeywordReply("none", "Acme HVAC")).toBeNull();
  });
});

