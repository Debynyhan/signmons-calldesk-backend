import { Injectable } from "@nestjs/common";
import { LoggingService } from "../../logging/logging.service";
import type {
  CallDeskSessionState,
  CallDeskStep,
  BookingFields,
} from "./call-desk-state";
import {
  hasFullName,
  missingFields,
  missingInfoFields,
} from "./call-desk-state";
import {
  detectCategory,
  detectUrgency,
  detectUrgencyAcknowledgement,
  extractBookingFields,
  detectFeeDisclosure,
  detectFeeConfirmation,
  detectUpsellOffer,
  detectAffirmation,
  detectRequestedField,
  extractAddressPartsFromMessage,
  assembleAddress,
  getAddressParts,
  isNameCandidate,
  isCompleteAddress,
  mergeBookingFields,
} from "./state-helpers";

type PartialStateUpdate = Partial<
  CallDeskSessionState & { fields: Partial<BookingFields> }
>;

@Injectable()
export class SessionStateService {
  private readonly sessionStore = new Map<string, CallDeskSessionState>();

  constructor(private readonly loggingService: LoggingService) {}

  getState(tenantId: string, sessionId: string): CallDeskSessionState {
    const key = this.composeKey(tenantId, sessionId);
    const existing = this.sessionStore.get(key);
    if (existing) {
      return this.cloneState(existing);
    }

    const initial = this.createInitialState();
    this.sessionStore.set(key, initial);
    return this.cloneState(initial);
  }

  updateState(
    tenantId: string,
    sessionId: string,
    updates: PartialStateUpdate,
  ): CallDeskSessionState {
    const key = this.composeKey(tenantId, sessionId);
    const current = this.sessionStore.get(key) ?? this.createInitialState();
    const next: CallDeskSessionState = {
      ...current,
      ...updates,
      fields: {
        ...current.fields,
        ...(updates.fields ?? {}),
      },
    };
    this.sessionStore.set(key, next);
    return this.cloneState(next);
  }

  resetState(tenantId: string, sessionId: string): void {
    const key = this.composeKey(tenantId, sessionId);
    this.sessionStore.delete(key);
  }

  getPromptState(
    tenantId: string,
    sessionId: string,
  ): Record<string, unknown> {
    const state = this.getState(tenantId, sessionId);
    return {
      step: state.step,
      category: state.category ?? null,
      urgency: state.urgency ?? null,
      urgency_acknowledged: state.urgency_acknowledged,
      fee_disclosed: state.fee_disclosed,
      fee_confirmed: state.fee_confirmed,
      upsell_offered: state.upsell_offered,
      emergency_flagged: state.emergency_flagged,
      name_acknowledged: state.name_acknowledged,
      address_confirmed: state.address_confirmed,
      empathy_used: state.empathy_used,
      last_captured_field: state.last_captured_field ?? null,
      fields: state.fields,
      missing_fields: missingInfoFields(state),
    };
  }

  setStep(
    tenantId: string,
    sessionId: string,
    step: CallDeskStep,
  ): CallDeskSessionState {
    return this.updateState(tenantId, sessionId, { step });
  }

  updateFromUserMessage(
    tenantId: string,
    sessionId: string,
    message: string,
  ): CallDeskSessionState {
    const key = this.composeKey(tenantId, sessionId);
    const current = this.sessionStore.get(key) ?? this.createInitialState();
    const enriched = this.applyUserMessage(current, message);
    this.sessionStore.set(key, enriched);
    return this.cloneState(enriched);
  }

  previewAssistantUpdate(
    state: CallDeskSessionState,
    assistantText: string,
  ): CallDeskSessionState {
    return this.applyAssistantHeuristics(state, assistantText, false);
  }

  applyAssistantReply(
    tenantId: string,
    sessionId: string,
    assistantText: string,
  ): CallDeskSessionState {
    const key = this.composeKey(tenantId, sessionId);
    const current = this.sessionStore.get(key) ?? this.createInitialState();
    const updated = this.applyAssistantHeuristics(
      current,
      assistantText,
      true,
    );
    this.sessionStore.set(key, updated);
    return this.cloneState(updated);
  }

  applyExplicitFields(
    tenantId: string,
    sessionId: string,
    payload: {
      fields?: Partial<BookingFields>;
      category?: CallDeskSessionState["category"];
      urgency?: CallDeskSessionState["urgency"];
      feeDisclosed?: boolean;
      feeConfirmed?: boolean;
      upsellOffered?: boolean;
      emergencyFlagged?: boolean;
    },
  ): CallDeskSessionState {
    const key = this.composeKey(tenantId, sessionId);
    const current = this.sessionStore.get(key) ?? this.createInitialState();
    const mergedFields = payload.fields
      ? mergeBookingFields(current.fields, payload.fields)
      : current.fields;
    const next: CallDeskSessionState = {
      ...current,
      category: payload.category ?? current.category,
      urgency: payload.urgency ?? current.urgency,
      fee_disclosed: payload.feeDisclosed ?? current.fee_disclosed,
      fee_confirmed: payload.feeConfirmed ?? current.fee_confirmed,
      upsell_offered: payload.upsellOffered ?? current.upsell_offered,
      emergency_flagged:
        payload.emergencyFlagged ?? current.emergency_flagged,
      fields: mergedFields,
    };
    this.sessionStore.set(key, next);
    return this.cloneState(next);
  }

  private composeKey(tenantId: string, sessionId: string): string {
    return `${tenantId}:${sessionId}`;
  }

  private createInitialState(): CallDeskSessionState {
    return {
      step: "GREETING",
      category: null,
      urgency: null,
      urgency_acknowledged: false,
      fee_disclosed: false,
      fee_confirmed: false,
      upsell_offered: false,
      emergency_flagged: false,
      name_acknowledged: false,
      address_confirmed: false,
      empathy_used: false,
      last_captured_field: null,
      last_requested_field: null,
      fields: {
        name: undefined,
        phone: undefined,
        address: undefined,
        issue: undefined,
        photos: undefined,
        preferred_window: undefined,
      },
    };
  }

  private cloneState(state: CallDeskSessionState): CallDeskSessionState {
    return {
      ...state,
      fields: { ...state.fields },
    };
  }

  private applyUserMessage(
    state: CallDeskSessionState,
    message: string,
  ): CallDeskSessionState {
    const extracted = extractBookingFields(message);
    const addressBase = extracted.address ?? state.fields.address;
    const mergedPartialAddress = this.mergePartialAddress(
      addressBase,
      message,
    );
    if (mergedPartialAddress) {
      extracted.address = mergedPartialAddress;
    }
    const fallbackName = this.extractNameFromReply(state, message);
    if (!extracted.name && fallbackName) {
      extracted.name = fallbackName;
    }
    if (!extracted.name && !state.fields.name) {
      const looseName = this.extractNameFromLooseMessage(message);
      if (looseName) {
        extracted.name = looseName;
      }
    }
    const mergedFields = mergeBookingFields(state.fields, extracted);
    const combinedName = this.combineNameParts(state.fields.name, extracted.name);
    if (combinedName) {
      mergedFields.name = combinedName;
    }
    const categoryFromIssue = mergedFields.issue
      ? detectCategory(mergedFields.issue)
      : null;
    const category = state.category ?? categoryFromIssue ?? detectCategory(message);
    let urgency = state.urgency ?? detectUrgency(message);
    if (!urgency && state.step === "URGENCY" && detectAffirmation(message)) {
      urgency = "EMERGENCY";
    }
    const isEmergency = urgency === "EMERGENCY";
    const feeConfirmed =
      state.fee_disclosed && detectFeeConfirmation(message);
    const addressComplete = isCompleteAddress(mergedFields.address);
    const addressProvided = Boolean(extracted.address);
    const addressConfirmed =
      state.address_confirmed ||
      (addressComplete && addressProvided) ||
      (state.last_requested_field === "address" &&
        addressComplete &&
        (detectAffirmation(message) || addressProvided));
    const newlyCapturedField = this.detectNewlyCapturedField(
      state,
      mergedFields,
      addressConfirmed,
    );
    if (feeConfirmed && !state.fee_confirmed) {
      this.loggingService.log(
        "Fee confirmed by caller.",
        SessionStateService.name,
      );
    }
    const updated: CallDeskSessionState = {
      ...state,
      fields: mergedFields,
      category: category ?? null,
      urgency: urgency ?? null,
      emergency_flagged: state.emergency_flagged || isEmergency,
      fee_confirmed: state.fee_confirmed || feeConfirmed,
      address_confirmed: addressConfirmed,
      last_captured_field: newlyCapturedField,
    };
    return this.advanceStep(updated);
  }

  private applyAssistantHeuristics(
    state: CallDeskSessionState,
    assistantText: string,
    persist: boolean,
  ): CallDeskSessionState {
    const feeDisclosed =
      state.fee_disclosed || detectFeeDisclosure(assistantText);
    const upsell =
      state.upsell_offered || detectUpsellOffer(assistantText);
    const requestedField = detectRequestedField(assistantText);
    const urgencyAcknowledged =
      state.urgency_acknowledged ||
      detectUrgencyAcknowledgement(assistantText, state.urgency);
    const empathyUsed =
      state.empathy_used || /sorry|we'?ll take care|got you taken care/i.test(assistantText);
    const updated = this.advanceStep({
      ...state,
      fee_disclosed: feeDisclosed,
      upsell_offered: upsell,
      last_requested_field: requestedField,
      urgency_acknowledged: urgencyAcknowledged,
      empathy_used: empathyUsed,
      last_captured_field: null,
    });
    return persist ? updated : this.cloneState(updated);
  }

  private advanceStep(state: CallDeskSessionState): CallDeskSessionState {
    let current = state;
    while (true) {
      const nextStep = this.computeNextStep(current);
      if (nextStep === current.step) {
        return current;
      }
      current = { ...current, step: nextStep };
    }
  }

  private computeNextStep(state: CallDeskSessionState): CallDeskStep {
    switch (state.step) {
      case "GREETING":
        return "CATEGORY";
      case "CATEGORY":
        return state.category ? "URGENCY" : "CATEGORY";
      case "URGENCY":
        return state.urgency ? "INFO_COLLECTION" : "URGENCY";
      case "INFO_COLLECTION":
        return missingFields(state).length === 0
          ? "PRICING"
          : "INFO_COLLECTION";
      case "PRICING":
        return state.fee_confirmed ? "UPSELL" : "PRICING";
      case "UPSELL":
        return missingFields(state).length === 0 ? "BOOKING" : "UPSELL";
      case "BOOKING":
        return "BOOKING";
      case "CLOSEOUT":
        return "CLOSEOUT";
      default:
        return state.step;
    }
  }

  private mergePartialAddress(
    existing: string | undefined,
    message: string,
  ): string | null {
    const baseParts = existing ? getAddressParts(existing) : {};
    const incomingParts = extractAddressPartsFromMessage(message);
    const hasIncoming =
      incomingParts.street ||
      incomingParts.city ||
      incomingParts.state ||
      incomingParts.zip;
    if (!hasIncoming) {
      return null;
    }

    const merged = { ...baseParts };
    const incomingHasStreet = Boolean(incomingParts.street);
    const incomingHasContext = Boolean(
      incomingParts.city || incomingParts.state || incomingParts.zip,
    );

    if (incomingHasStreet && incomingHasContext) {
      if (incomingParts.street) merged.street = incomingParts.street;
      if (incomingParts.city) merged.city = incomingParts.city;
      if (incomingParts.state) merged.state = incomingParts.state;
      if (incomingParts.zip) merged.zip = incomingParts.zip;
    } else {
      if (!merged.street && incomingParts.street) {
        merged.street = incomingParts.street;
      }
      if (!merged.city && incomingParts.city) {
        merged.city = incomingParts.city;
      }
      if (!merged.state && incomingParts.state) {
        merged.state = incomingParts.state;
      }
      if (!merged.zip && incomingParts.zip) {
        merged.zip = incomingParts.zip;
      }
    }

    const assembled = assembleAddress(merged);
    if (!assembled) {
      return null;
    }
    if (existing && assembled.toLowerCase() === existing.toLowerCase()) {
      return null;
    }
    return assembled;
  }

  private extractNameFromReply(
    state: CallDeskSessionState,
    message: string,
  ): string | null {
    if (state.last_requested_field !== "name") {
      return null;
    }
    const cleaned = message.trim();
    if (!cleaned) {
      return null;
    }
    const tokens = cleaned
      .split(/\s+/)
      .map((token) => token.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, ""))
      .filter(Boolean);
    if (tokens.length > 3) {
      return null;
    }
    if (!tokens.every((token) => /^[A-Za-z][A-Za-z'’-]*$/.test(token))) {
      return null;
    }
    const candidate = tokens.join(" ");
    return isNameCandidate(candidate) ? candidate : null;
  }

  private extractNameFromLooseMessage(message: string): string | null {
    const cleaned = message.trim();
    if (!cleaned) {
      return null;
    }
    if (/\d/.test(cleaned)) {
      return null;
    }
    const tokens = cleaned
      .split(/\s+/)
      .map((token) => token.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, ""))
      .filter(Boolean);
    if (tokens.length === 0 || tokens.length > 3) {
      return null;
    }
    if (!tokens.every((token) => /^[A-Za-z][A-Za-z'’-]*$/.test(token))) {
      return null;
    }
    const candidate = tokens.join(" ");
    return isNameCandidate(candidate) ? candidate : null;
  }

  private combineNameParts(
    existing?: string,
    incoming?: string,
  ): string | null {
    if (!existing || !incoming) {
      return null;
    }
    const existingTokens = existing.trim().split(/\s+/).filter(Boolean);
    const incomingTokens = incoming.trim().split(/\s+/).filter(Boolean);
    if (existingTokens.length !== 1 || incomingTokens.length !== 1) {
      return null;
    }
    if (
      existingTokens[0].toLowerCase() ===
      incomingTokens[0].toLowerCase()
    ) {
      return null;
    }
    return `${existingTokens[0]} ${incomingTokens[0]}`;
  }

  private detectNewlyCapturedField(
    state: CallDeskSessionState,
    nextFields: BookingFields,
    addressConfirmed: boolean,
  ): keyof BookingFields | null {
    if (!state.fields.phone && nextFields.phone) {
      return "phone";
    }
    if (!hasFullName(state.fields.name) && hasFullName(nextFields.name)) {
      return "name";
    }
    if (
      (!state.fields.address || !state.address_confirmed) &&
      addressConfirmed
    ) {
      return "address";
    }
    if (!state.fields.issue && nextFields.issue) {
      return "issue";
    }
    if (!state.fields.preferred_window && nextFields.preferred_window) {
      return "preferred_window";
    }
    return null;
  }
}
