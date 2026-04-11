import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  getVoiceAddressStateFromCollectedData,
  getVoiceNameStateFromCollectedData,
  getVoiceSmsPhoneStateFromCollectedData,
  getVoiceUrgencyConfirmationFromCollectedData,
} from "../conversations/voice-conversation-state.codec";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { DEFAULT_FEE_POLICY } from "../tenants/fee-policy";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { IntakeLinkService } from "./intake-link.service";

export type IntakeFeeContext = {
  tenantId: string;
  conversationId: string;
  customerPhone: string | null;
  callerPhone: string | null;
  fullName: string | null;
  address: string | null;
  issue: string | null;
  isEmergency: boolean;
  displayName: string;
  serviceFeeCents: number;
  emergencyFeeCents: number;
  creditWindowHours: number;
  currency: string;
  existingJobId: string | null;
  collectedData: Prisma.JsonValue | null;
};

@Injectable()
export class IntakeFeeCalculatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
    private readonly intakeLinkService: IntakeLinkService,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
  ) {}

  async resolveIntakeContext(token: string): Promise<IntakeFeeContext> {
    const parsed = this.intakeLinkService.verifyConversationToken(token);
    if (!parsed) {
      throw new UnauthorizedException("Invalid or expired intake link.");
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: parsed.tid,
        id: parsed.cid,
      },
      include: {
        customer: true,
        jobLinks: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException("Conversation not found.");
    }

    const tenant = await this.tenantsService.getTenantById(parsed.tid);
    if (!tenant) {
      throw new NotFoundException("Tenant not found.");
    }

    const policy =
      (await this.tenantsService.getTenantFeePolicy(parsed.tid)) ??
      DEFAULT_FEE_POLICY;
    const collectedData = conversation.collectedData ?? null;
    const nameState = getVoiceNameStateFromCollectedData(collectedData);
    const addressState = getVoiceAddressStateFromCollectedData(collectedData);
    const phoneState = getVoiceSmsPhoneStateFromCollectedData(collectedData);
    const urgency = getVoiceUrgencyConfirmationFromCollectedData(collectedData);
    const issue = this.extractIssue(collectedData);

    const fullName =
      this.sanitizeText(nameState.confirmed.value) ??
      this.sanitizeText(nameState.candidate.value) ??
      this.sanitizeText(conversation.customer?.fullName) ??
      null;
    const address =
      this.sanitizeText(addressState.confirmed) ??
      this.sanitizeText(addressState.candidate) ??
      null;
    const customerPhone = this.normalizePhone(phoneState.value);
    const callerPhone = this.extractCallerPhone(collectedData);
    const displayName = this.resolveTenantDisplayName(tenant.settings, tenant.name);

    return {
      tenantId: parsed.tid,
      conversationId: parsed.cid,
      customerPhone,
      callerPhone,
      fullName,
      address,
      issue,
      isEmergency: urgency.response === "YES",
      displayName,
      serviceFeeCents: policy.serviceFeeCents,
      emergencyFeeCents: policy.emergencyFeeCents,
      creditWindowHours: policy.creditWindowHours,
      currency: policy.currency.toUpperCase(),
      existingJobId: conversation.jobLinks[0]?.jobId ?? null,
      collectedData,
    };
  }

  computeTotalCents(
    context: {
      serviceFeeCents: number;
      emergencyFeeCents: number;
    },
    isEmergency: boolean,
  ): number {
    return Math.max(
      0,
      context.serviceFeeCents + (isEmergency ? context.emergencyFeeCents : 0),
    );
  }

  inferIssueCategory(issue: string): string {
    const normalized = issue.toLowerCase();
    if (/\b(heat|furnace|boiler)\b/.test(normalized)) {
      return "HEATING";
    }
    if (/\b(ac|cool|air conditioning|compressor)\b/.test(normalized)) {
      return "COOLING";
    }
    if (/\b(pipe|drain|leak|water|plumb)\b/.test(normalized)) {
      return "PLUMBING";
    }
    if (/\b(outlet|breaker|electric|panel|power)\b/.test(normalized)) {
      return "ELECTRICAL";
    }
    return "GENERAL";
  }

  formatFeeAmount(cents: number): string {
    const dollars = Math.max(0, cents) / 100;
    return `$${dollars.toFixed(2)}`;
  }

  private resolveTenantDisplayName(settings: unknown, fallback: string): string {
    if (settings && typeof settings === "object") {
      const value = (settings as { displayName?: unknown }).displayName;
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return fallback;
  }

  private extractIssue(collectedData: Prisma.JsonValue | null): string | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const issueCandidate = (collectedData as Record<string, unknown>)
      .issueCandidate;
    if (!issueCandidate || typeof issueCandidate !== "object") {
      return null;
    }
    const value = (issueCandidate as { value?: unknown }).value;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private extractCallerPhone(collectedData: Prisma.JsonValue | null): string | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const value = (collectedData as Record<string, unknown>).callerPhone;
    return typeof value === "string" ? this.normalizePhone(value) : null;
  }

  private sanitizeText(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const sanitized = this.sanitizationService.sanitizeText(value);
    return sanitized.length ? sanitized : null;
  }

  private normalizePhone(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const normalized = this.sanitizationService.normalizePhoneE164(value);
    return normalized || null;
  }
}
