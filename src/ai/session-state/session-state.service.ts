import { Injectable } from "@nestjs/common";
import { LoggingService } from "../../logging/logging.service";
import type {
  CallDeskSessionState,
  CallDeskStep,
  BookingFields,
} from "./call-desk-state";
import { missingFields, missingInfoFields } from "./call-desk-state";
import {
  detectCategory,
  detectUrgency,
  extractBookingFields,
  detectFeeDisclosure,
  detectFeeConfirmation,
  detectUpsellOffer,
  detectAffirmation,
  detectRequestedField,
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
      fee_disclosed: state.fee_disclosed,
      fee_confirmed: state.fee_confirmed,
      upsell_offered: state.upsell_offered,
      emergency_flagged: state.emergency_flagged,
      name_acknowledged: state.name_acknowledged,
      address_confirmed: state.address_confirmed,
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
      fee_disclosed: false,
      fee_confirmed: false,
      upsell_offered: false,
      emergency_flagged: false,
      name_acknowledged: false,
      address_confirmed: false,
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
    const mergedFields = mergeBookingFields(state.fields, extracted);
    const categoryFromIssue = mergedFields.issue
      ? detectCategory(mergedFields.issue)
      : null;
    const category = state.category ?? categoryFromIssue ?? detectCategory(message);
    const urgency = state.urgency ?? detectUrgency(message);
    const isEmergency = urgency === "EMERGENCY";
    const feeConfirmed =
      state.fee_disclosed && detectFeeConfirmation(message);
    const addressConfirmed = state.address_confirmed
      || (state.last_requested_field === "address"
        && Boolean(mergedFields.address)
        && (detectAffirmation(message) || Boolean(extracted.address)));
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
    const updated = this.advanceStep({
      ...state,
      fee_disclosed: feeDisclosed,
      upsell_offered: upsell,
      last_requested_field: requestedField,
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
}
