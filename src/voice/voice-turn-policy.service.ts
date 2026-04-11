import { Injectable } from "@nestjs/common";
import { type TenantOrganization } from "@prisma/client";
import {
  extractNameCandidateDeterministic,
  isLikelyNameCandidate,
  isValidNameCandidate,
  normalizeNameCandidate,
} from "./intake/voice-name-candidate.policy";
import * as voiceAddressCandidatePolicy from "./intake/voice-address-candidate.policy";
import { normalizeConfirmationUtterance } from "./intake/voice-field-confirmation.policy";
import {
  buildVoiceFallbackIssueCandidate,
  buildVoiceIssueAcknowledgement,
  isLikelyVoiceIssueCandidate,
  isVoiceComfortRiskRelevant,
  isVoiceIssueRepeatComplaint,
  normalizeVoiceIssueCandidate,
} from "./intake/voice-issue-candidate.policy";
import { SanitizationService } from "../sanitization/sanitization.service";
import { VoiceUtteranceService } from "./voice-utterance.service";

type VoiceIssueCandidate = { value?: string; sourceEventId?: string } | null;
type VoiceNameStateLike = {
  confirmed: { value: string | null };
  candidate: { value: string | null };
  locked: boolean;
};
type VoiceAddressStateLike = {
  confirmed: string | null;
  locked: boolean;
  smsConfirmNeeded?: boolean;
};
type VoiceUrgencyConfirmation = {
  askedAt: string | null;
  response: "YES" | "NO" | null;
  sourceEventId: string | null;
};

@Injectable()
export class VoiceTurnPolicyService {
  constructor(
    private readonly sanitizationService: SanitizationService,
    private readonly voiceUtteranceService: VoiceUtteranceService,
  ) {}

  getVoiceIssueCandidate(collectedData: unknown): VoiceIssueCandidate {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const record = collectedData as Record<string, unknown>;
    const candidate = record.issueCandidate as
      | { value?: string; sourceEventId?: string }
      | undefined;
    if (!candidate?.value) {
      return null;
    }
    return candidate;
  }

  getVoiceNameCandidate(nameState: VoiceNameStateLike): string | null {
    return nameState.confirmed.value ?? nameState.candidate.value ?? null;
  }

  normalizeIssueCandidate(value: string): string {
    return normalizeVoiceIssueCandidate(value, {
      sanitizeText: (input) => this.sanitizationService.sanitizeText(input),
      normalizeWhitespace: (input) =>
        this.sanitizationService.normalizeWhitespace(input),
    });
  }

  buildFallbackIssueCandidate(value: string): string | null {
    return buildVoiceFallbackIssueCandidate(value, {
      normalizeIssueCandidate: (input) => this.normalizeIssueCandidate(input),
      isLikelyQuestion: (input) =>
        this.voiceUtteranceService.isLikelyQuestion(input),
      resolveBinaryUtterance: (input) =>
        this.voiceUtteranceService.resolveBinaryUtterance(input),
    });
  }

  isComfortRiskRelevant(value: string): boolean {
    return isVoiceComfortRiskRelevant(value, (input) =>
      this.normalizeIssueCandidate(input),
    );
  }

  buildIssueAcknowledgement(value: string): string | null {
    return buildVoiceIssueAcknowledgement(value, {
      normalizeIssueCandidate: (input) => this.normalizeIssueCandidate(input),
      normalizeWhitespace: (input) =>
        this.sanitizationService.normalizeWhitespace(input),
    });
  }

  isLikelyIssueCandidate(value: string): boolean {
    return isLikelyVoiceIssueCandidate(value, (input) =>
      this.normalizeIssueCandidate(input),
    );
  }

  isIssueRepeatComplaint(value: string): boolean {
    return isVoiceIssueRepeatComplaint(value);
  }

  isVoiceFieldReady(locked: boolean, confirmed: string | null): boolean {
    return locked && confirmed === null;
  }

  shouldDiscloseFees(params: {
    nameState: VoiceNameStateLike;
    addressState: VoiceAddressStateLike;
    collectedData: unknown;
    currentSpeech?: string;
  }): boolean {
    const nameReady =
      Boolean(params.nameState.confirmed.value) ||
      this.isVoiceFieldReady(
        params.nameState.locked,
        params.nameState.confirmed.value,
      );
    const addressReady =
      Boolean(params.addressState.confirmed) ||
      this.isVoiceFieldReady(
        params.addressState.locked,
        params.addressState.confirmed,
      ) ||
      Boolean(params.addressState.smsConfirmNeeded);
    if (!nameReady || !addressReady) {
      return false;
    }
    const existingIssue = this.getVoiceIssueCandidate(params.collectedData);
    if (existingIssue?.value) {
      return true;
    }
    if (!params.currentSpeech) {
      return false;
    }
    const normalizedIssue = this.normalizeIssueCandidate(params.currentSpeech);
    return this.isLikelyIssueCandidate(normalizedIssue);
  }

  getTenantDisplayName(tenant: TenantOrganization): string {
    if (tenant.settings && typeof tenant.settings === "object") {
      const settings = tenant.settings as Record<string, unknown>;
      const displayName = settings.displayName;
      if (typeof displayName === "string" && displayName.trim()) {
        return displayName.trim();
      }
    }
    return tenant.name;
  }

  isUrgencyEmergency(collectedData: unknown): boolean {
    if (!collectedData || typeof collectedData !== "object") {
      return false;
    }
    const data = collectedData as Record<string, unknown>;
    const urgencyConfirmation = this.getVoiceUrgencyConfirmation(data);
    if (urgencyConfirmation.response === "YES") {
      return true;
    }
    const urgencyConfirmed =
      typeof data.urgencyConfirmed === "boolean"
        ? data.urgencyConfirmed
        : false;
    if (!urgencyConfirmed) {
      return false;
    }
    const urgency = data.urgency;
    if (typeof urgency === "string") {
      const normalized = urgency.trim().toUpperCase();
      return normalized === "EMERGENCY" || normalized === "URGENT";
    }
    return typeof urgency === "boolean" ? urgency : false;
  }

  isPaymentRequiredNext(collectedData: unknown): boolean {
    if (!collectedData || typeof collectedData !== "object") {
      return false;
    }
    const data = collectedData as Record<string, unknown>;
    return Boolean(data.paymentRequired);
  }

  isSoftConfirmationEligible(params: {
    fieldType: "name" | "address";
    candidate: string;
    utterance: string;
    confidence?: number;
    minConfidence: number;
  }): boolean {
    if (typeof params.confidence !== "number") {
      return false;
    }
    if (params.confidence < params.minConfidence) {
      return false;
    }
    const normalizedCandidate =
      params.fieldType === "name"
        ? normalizeNameCandidate(params.utterance, this.sanitizationService)
        : this.sanitizationService.normalizeWhitespace(
            voiceAddressCandidatePolicy.normalizeAddressCandidate(
              params.utterance,
              this.sanitizationService,
            ),
          );
    if (!normalizedCandidate) {
      return false;
    }
    if (params.fieldType === "name") {
      if (
        !isValidNameCandidate(normalizedCandidate) ||
        !isLikelyNameCandidate(normalizedCandidate)
      ) {
        return false;
      }
    } else if (
      voiceAddressCandidatePolicy.isIncompleteAddress(normalizedCandidate)
    ) {
      return false;
    }
    return (
      normalizedCandidate.trim().toLowerCase() ===
      params.candidate.trim().toLowerCase()
    );
  }

  isOpeningGreetingOnly(transcript: string): boolean {
    const normalized = normalizeConfirmationUtterance(transcript);
    if (!normalized) {
      return false;
    }
    if (
      extractNameCandidateDeterministic(transcript, this.sanitizationService)
    ) {
      return false;
    }
    if (this.isLikelyIssueCandidate(this.normalizeIssueCandidate(normalized))) {
      return false;
    }
    return /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|are you there|can you hear me|you there|testing|did you get that)[\s,.!?]*$/.test(
      normalized,
    );
  }

  isLikelyAddressInputForName(transcript: string): boolean {
    if (!transcript) {
      return false;
    }
    const normalized = voiceAddressCandidatePolicy.normalizeAddressCandidate(
      transcript,
      this.sanitizationService,
    );
    const lowered = normalized.toLowerCase();
    if (!lowered) {
      return false;
    }
    if (
      /^(?:my\s+address\s+is|the\s+address\s+is|address\s+is|service\s+address\s+is)\b/.test(
        lowered,
      )
    ) {
      return true;
    }
    const stripped = voiceAddressCandidatePolicy.stripAddressLeadIn(
      normalized,
      this.sanitizationService,
    );
    return voiceAddressCandidatePolicy.isLikelyAddressCandidate(stripped);
  }

  normalizeConfidence(value: string | number | null | undefined): number | undefined {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }
    const parsed = Number.parseFloat(String(value));
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    if (parsed >= 0 && parsed <= 1) {
      return parsed;
    }
    if (parsed > 1 && parsed <= 100) {
      return parsed / 100;
    }
    return undefined;
  }

  private getVoiceUrgencyConfirmation(
    collectedData: unknown,
  ): VoiceUrgencyConfirmation {
    if (!collectedData || typeof collectedData !== "object") {
      return { askedAt: null, response: null, sourceEventId: null };
    }
    const data = collectedData as Record<string, unknown>;
    const raw = data.voiceUrgencyConfirmation;
    if (!raw || typeof raw !== "object") {
      return { askedAt: null, response: null, sourceEventId: null };
    }
    const record = raw as Partial<VoiceUrgencyConfirmation>;
    const response =
      record.response === "YES" || record.response === "NO"
        ? record.response
        : null;
    return {
      askedAt: typeof record.askedAt === "string" ? record.askedAt : null,
      response,
      sourceEventId:
        typeof record.sourceEventId === "string" ? record.sourceEventId : null,
    };
  }
}
