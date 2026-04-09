import type { AppConfig } from "../../config/app.config";
import { CsrStrategy } from "../csr-strategy.selector";
import { VoicePromptComposerService } from "../voice-prompt-composer.service";

const makeConfig = (): AppConfig =>
  ({
    twilioWebhookBaseUrl: "https://example.ngrok.io",
  }) as AppConfig;

describe("VoicePromptComposerService", () => {
  it("builds gather TwiML with escaped content and webhook action", () => {
    const service = new VoicePromptComposerService(makeConfig());
    const twiml = service.buildSayGatherTwiml(
      `What's <next> & "urgent"?`,
      { timeout: 8, bargeIn: true },
    );

    expect(twiml).toContain("<Gather input=\"speech\"");
    expect(twiml).toContain(
      "action=\"https://example.ngrok.io/api/voice/turn\"",
    );
    expect(twiml).toContain(
      "<Say>What&apos;s &lt;next&gt; &amp; &quot;urgent&quot;?</Say>",
    );
    expect(twiml).toContain("timeout=\"8\"");
    expect(twiml).toContain("bargeIn=\"true\"");
  });

  it("prepends side-question preface while preserving gather options", () => {
    const service = new VoicePromptComposerService(makeConfig());
    const base = service.buildAskAddressTwiml();
    const combined = service.prependPrefaceToGatherTwiml(
      "Absolutely.",
      base,
    );

    expect(combined).toContain("<Say>Absolutely. What&apos;s the service address?</Say>");
    expect(combined).toContain("timeout=\"8\"");
    expect(combined).toContain("bargeIn=\"true\"");
  });

  it("applies CSR strategy prefix only when needed", () => {
    const service = new VoicePromptComposerService(makeConfig());

    expect(
      service.applyCsrStrategy(
        CsrStrategy.EMPATHY,
        "What is the service address?",
      ),
    ).toBe("I'm here to help. What is the service address?");

    expect(
      service.applyCsrStrategy(CsrStrategy.OPENING, "Thanks, I have that."),
    ).toBe("Thanks, I have that.");
  });
});
