import { Inject, Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import appConfig, { type AppConfig } from "../config/app.config";

type IntakeTokenPayload = {
  v: 1;
  tid: string;
  cid: string;
  iat: number;
  exp: number;
  nonce: string;
};

@Injectable()
export class IntakeLinkService {
  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
  ) {}

  createConversationToken(params: {
    tenantId: string;
    conversationId: string;
    ttlMinutes?: number;
  }): { token: string; expiresAt: string } {
    const nowMs = Date.now();
    const ttlMinutes = Math.max(
      5,
      params.ttlMinutes ?? this.config.smsIntakeLinkTtlMinutes ?? 1440,
    );
    const payload: IntakeTokenPayload = {
      v: 1,
      tid: params.tenantId,
      cid: params.conversationId,
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor((nowMs + ttlMinutes * 60_000) / 1000),
      nonce: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const signature = this.sign(encoded);
    return {
      token: `${encoded}.${signature}`,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  verifyConversationToken(token: string): IntakeTokenPayload | null {
    const trimmed = token.trim();
    if (!trimmed) {
      return null;
    }
    const [encoded, signature] = trimmed.split(".");
    if (!encoded || !signature) {
      return null;
    }
    const expectedSignature = this.sign(encoded);
    if (!this.constantTimeEquals(signature, expectedSignature)) {
      return null;
    }
    let parsed: IntakeTokenPayload | null = null;
    try {
      parsed = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as IntakeTokenPayload;
    } catch {
      return null;
    }
    if (
      !parsed ||
      parsed.v !== 1 ||
      typeof parsed.tid !== "string" ||
      typeof parsed.cid !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp * 1000 < Date.now()) {
      return null;
    }
    return parsed;
  }

  buildIntakeUrl(token: string): string {
    const base =
      this.config.smsIntakeBaseUrl || this.config.twilioWebhookBaseUrl || "";
    if (!base) {
      return `/api/payments/intake/${encodeURIComponent(token)}`;
    }
    return `${base.replace(/\/$/, "")}/api/payments/intake/${encodeURIComponent(
      token,
    )}`;
  }

  isStripeConfigured(): boolean {
    return Boolean(this.config.stripeSecretKey);
  }

  hasPublicIntakeBaseUrl(): boolean {
    const base =
      this.config.smsIntakeBaseUrl || this.config.twilioWebhookBaseUrl || "";
    return base.trim().length > 0;
  }

  private sign(encodedPayload: string): string {
    return createHmac("sha256", this.config.smsIntakeLinkSecret)
      .update(encodedPayload)
      .digest("base64url");
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const aBytes = Buffer.from(a, "utf8");
    const bBytes = Buffer.from(b, "utf8");
    if (aBytes.length !== bBytes.length) {
      return false;
    }
    return timingSafeEqual(aBytes, bBytes);
  }
}
