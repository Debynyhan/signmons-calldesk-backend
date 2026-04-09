import { Inject, Injectable } from "@nestjs/common";
import appConfig, { type AppConfig } from "../config/app.config";
import { CsrStrategy } from "./csr-strategy.selector";

@Injectable()
export class VoicePromptComposerService {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
  ) {}

  public disabledTwiml(): string {
    return this.buildTwiml(
      "Voice intake is currently unavailable. Please try again later.",
    );
  }

  public unroutableTwiml(): string {
    return this.buildTwiml("We're unable to route your call at this time.");
  }

  public buildConsentMessage(displayName: string): string {
    const tenantLabel = displayName?.trim() || "our team";
    return `Thank you for calling ${tenantLabel}. This is Signmons. This call may be transcribed and handled by automated systems for service and quality purposes. By continuing, you consent to this process. How may I help you?`;
  }

  public buildConsentTwiml(displayName: string): string {
    const composed = this.buildConsentMessage(displayName);
    return this.buildSayGatherTwiml(composed, { timeout: 5 });
  }

  public buildSayGatherTwiml(
    message: string,
    options?: { timeout?: number; bargeIn?: boolean },
  ): string {
    const actionUrl = this.buildWebhookUrl("/api/voice/turn");
    const timeout = options?.timeout ?? 5;
    const bargeIn = options?.bargeIn !== false ? ' bargeIn="true"' : "";
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Gather input="speech" action="${this.escapeXml(
      actionUrl,
    )}" method="POST" timeout="${timeout}" speechTimeout="auto"${bargeIn}/></Response>`;
  }

  public buildRepromptTwiml(strategy?: CsrStrategy): string {
    const message = this.applyCsrStrategy(
      strategy,
      "Sorry, I didn't catch that. Please say that again.",
    );
    return this.buildSayGatherTwiml(message);
  }

  public buildNameConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const firstName = candidate.split(" ").filter(Boolean)[0] ?? "";
    const thanks = firstName ? `Thanks, ${firstName}. ` : "Thanks. ";
    const core = `${thanks}I heard ${candidate}. If that's right, say 'yes'. Otherwise, say your full name again.`;
    const message = this.applyCsrStrategy(
      strategy,
      this.withPrefix("Got it. ", core),
    );
    return this.buildSayGatherTwiml(message, { bargeIn: true });
  }

  public buildNameSoftConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const firstName = candidate.split(" ").filter(Boolean)[0] ?? "";
    const thanks = firstName ? `Thanks, ${firstName}. ` : "Thanks. ";
    const core = `${thanks}I heard ${candidate}. If that's right, say 'yes'. Otherwise, say your full name again.`;
    const message = this.applyCsrStrategy(
      strategy,
      this.withPrefix("Got it. ", core),
    );
    return this.buildSayGatherTwiml(message, { bargeIn: true });
  }

  public buildAskNameTwiml(strategy?: CsrStrategy): string {
    const core = "What's your full name?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core));
  }

  public buildSpellNameTwiml(strategy?: CsrStrategy): string {
    const core = "Thanks—how do you spell your first name?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core));
  }

  public buildAskSmsNumberTwiml(strategy?: CsrStrategy): string {
    const core = "What's the best number to text updates to?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core));
  }

  public buildTakeYourTimeTwiml(
    field: "name" | "address" | "sms_phone",
    strategy?: CsrStrategy,
  ): string {
    let question = "How can I help?";
    let timeout = 5;
    if (field === "name") {
      question = "What's your full name?";
    } else if (field === "address") {
      question = "Please say the service address.";
      timeout = 8;
    } else if (field === "sms_phone") {
      question = "What's the best number to text updates to?";
    }
    const message = `Sure—take your time. ${question}`.trim();
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, message), {
      timeout,
    });
  }

  public buildBookingPromptTwiml(strategy?: CsrStrategy): string {
    const core = "Would you like to book a visit?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core));
  }

  public buildCallbackOfferTwiml(strategy?: CsrStrategy): string {
    const core = "I can have a dispatcher call you back. Is that okay?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core));
  }

  public buildComfortRiskTwiml(
    strategy?: CsrStrategy,
    context?: {
      callerName?: string | null;
      issueSummary?: string | null;
    },
  ): string {
    const firstName = context?.callerName?.split(" ").filter(Boolean)[0] ?? "";
    const introParts: string[] = [];
    if (firstName) {
      introParts.push(`Thanks, ${firstName}.`);
    }
    if (context?.issueSummary) {
      introParts.push(`I heard ${context.issueSummary}.`);
    }
    const question = "Is this an emergency right now?";
    const core = introParts.length
      ? `${introParts.join(" ")} ${question}`
      : question;
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core), {
      bargeIn: true,
    });
  }

  public buildUrgencyConfirmTwiml(
    strategy?: CsrStrategy,
    context?: {
      callerName?: string | null;
      issueSummary?: string | null;
    },
  ): string {
    const firstName = context?.callerName?.split(" ").filter(Boolean)[0] ?? "";
    const introParts: string[] = [];
    if (firstName) {
      introParts.push(`Thanks, ${firstName}.`);
    }
    if (context?.issueSummary) {
      introParts.push(`I heard ${context.issueSummary}.`);
    }
    const question = "Is this an emergency right now?";
    const core = introParts.length
      ? `${introParts.join(" ")} ${question}`
      : question;
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core), {
      bargeIn: true,
    });
  }

  public buildAddressConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const core = `Thanks. I heard ${candidate}. If that's right, say 'yes'. If not, say what needs to be corrected.`;
    const message = this.applyCsrStrategy(
      strategy,
      this.withPrefix("Got it. ", core),
    );
    return this.buildSayGatherTwiml(message, { timeout: 8, bargeIn: true });
  }

  public buildAddressSoftConfirmationTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const core = `Thanks. I heard ${candidate}. If that's right, say 'yes'. If not, say what needs to be corrected.`;
    const message = this.applyCsrStrategy(
      strategy,
      this.withPrefix("Got it. ", core),
    );
    return this.buildSayGatherTwiml(message, { timeout: 8, bargeIn: true });
  }

  public buildAddressLocalityPromptTwiml(strategy?: CsrStrategy): string {
    const core = "What city and state is that in, or what's the ZIP code?";
    const message = this.applyCsrStrategy(strategy, core);
    return this.buildSayGatherTwiml(message, { timeout: 8 });
  }

  public buildAskAddressTwiml(strategy?: CsrStrategy): string {
    const core = "What's the service address?";
    return this.buildSayGatherTwiml(this.applyCsrStrategy(strategy, core), {
      timeout: 8,
    });
  }

  public buildIncompleteAddressTwiml(
    candidate: string,
    strategy?: CsrStrategy,
  ): string {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    const tokens = normalized ? normalized.split(" ") : [];
    const numberIndex = tokens.findIndex((token) => /\d/.test(token));
    if (numberIndex === -1) {
      return this.buildSayGatherTwiml(
        this.applyCsrStrategy(
          strategy,
          "I didn't catch the house number. Please repeat the full street name and city.",
        ),
      );
    }
    const numberToken = tokens[numberIndex];
    const prefixTokens = tokens.slice(numberIndex + 1, numberIndex + 4);
    const prefix = prefixTokens.length ? ` ${prefixTokens.join(" ")}` : "";
    const core = `I heard: ${numberToken}${prefix}... That seems incomplete. Please repeat the full street name and city.`;
    const message = this.applyCsrStrategy(strategy, core);
    return this.buildSayGatherTwiml(message, { timeout: 8 });
  }

  public buildYesNoRepromptTwiml(strategy?: CsrStrategy): string {
    return this.buildSayGatherTwiml(
      this.applyCsrStrategy(
        strategy,
        this.withPrefix(
          "Sorry, I didn't catch that. ",
          "Please say 'yes' or say the correct details.",
        ),
      ),
      { bargeIn: true },
    );
  }

  public buildClosingTwiml(displayName: string, message: string): string {
    const tenantLabel = displayName?.trim();
    const prefix = tenantLabel
      ? `Thanks for calling. ${tenantLabel}. `
      : "Thanks for calling. ";
    return this.buildTwiml(`${prefix}${message}`);
  }

  public applyCsrStrategy(
    strategy: CsrStrategy | undefined,
    message: string,
  ): string {
    const prefix = this.getCsrPrefix(strategy);
    if (!prefix) {
      return message;
    }
    const normalizedMessage = message.trim().toLowerCase();
    const normalizedPrefix = prefix.toLowerCase();
    if (
      normalizedMessage.includes(normalizedPrefix) ||
      normalizedMessage.startsWith("thanks") ||
      normalizedMessage.startsWith("got it") ||
      normalizedMessage.startsWith("sorry")
    ) {
      return message;
    }
    return `${prefix} ${message}`.trim();
  }

  public withPrefix(prefix: string | undefined, message: string): string {
    if (!prefix) {
      return message;
    }
    const trimmed = message.trim();
    const normalized = trimmed.toLowerCase();
    const normalizedPrefix = prefix.trim().toLowerCase();
    if (normalized.startsWith(normalizedPrefix)) {
      return message;
    }
    return `${prefix}${message}`;
  }

  public extractSayMessages(twiml: string): string[] {
    const results: string[] = [];
    const regex = /<Say>(.*?)<\/Say>/g;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(twiml)) !== null) {
      const raw = this.unescapeXml(match[1] ?? "");
      const trimmed = raw.trim();
      if (trimmed) {
        results.push(trimmed);
      }
    }
    return results;
  }

  public extractGatherOptions(twiml: string): {
    timeout?: number;
    bargeIn?: boolean;
  } {
    const timeoutMatch = twiml.match(/timeout="(\d+)"/);
    const timeout = timeoutMatch ? Number(timeoutMatch[1]) : undefined;
    const bargeIn = /bargeIn="true"/.test(twiml) ? true : undefined;
    return {
      ...(typeof timeout === "number" ? { timeout } : {}),
      ...(bargeIn ? { bargeIn } : {}),
    };
  }

  public combineSideQuestionReply(preface: string, message: string): string {
    const cleanedPreface = preface.trim();
    const cleanedMessage = message.trim();
    if (!cleanedPreface) {
      return cleanedMessage;
    }
    if (!cleanedMessage) {
      return cleanedPreface;
    }
    const normalizedPreface = cleanedPreface.toLowerCase();
    const normalizedMessage = cleanedMessage.toLowerCase();
    if (normalizedMessage.startsWith(normalizedPreface)) {
      return cleanedMessage;
    }
    return `${cleanedPreface} ${cleanedMessage}`.replace(/\s+/g, " ").trim();
  }

  public prependPrefaceToGatherTwiml(
    preface: string,
    baseTwiml: string,
  ): string {
    const cleanedPreface = preface.trim();
    if (!cleanedPreface) {
      return baseTwiml;
    }
    const messages = this.extractSayMessages(baseTwiml);
    if (!messages.length) {
      return baseTwiml;
    }
    const baseMessage = messages.join(" ").trim();
    if (!baseMessage) {
      return baseTwiml;
    }
    const combined = this.combineSideQuestionReply(cleanedPreface, baseMessage);
    const options = this.extractGatherOptions(baseTwiml);
    return this.buildSayGatherTwiml(combined, options);
  }

  public buildTwiml(message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(
      message,
    )}</Say><Hangup/></Response>`;
  }

  private buildWebhookUrl(path: string): string {
    const baseUrl = this.config.twilioWebhookBaseUrl?.replace(/\/$/, "");
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  private getCsrPrefix(strategy: CsrStrategy | undefined): string {
    switch (strategy) {
      case CsrStrategy.OPENING:
        return "Thanks for calling.";
      case CsrStrategy.EMPATHY:
        return "I'm here to help.";
      case CsrStrategy.URGENCY_FRAMING:
        return "We'll treat this as urgent so we can help quickly.";
      case CsrStrategy.NEXT_STEP_POSITIONING:
        return "Here's what we'll do next.";
      default:
        return "";
    }
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private unescapeXml(value: string): string {
    return value
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");
  }
}
