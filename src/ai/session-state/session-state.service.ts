import { Injectable } from "@nestjs/common";
import type {
  CallDeskSessionState,
  CallDeskStep,
  BookingFields,
} from "./call-desk-state";
import { missingFields } from "./call-desk-state";
import {
  detectCategory,
  detectUrgency,
  extractBookingFields,
  detectFeeDisclosure,
  detectUpsellOffer,
} from "./state-helpers";

type PartialStateUpdate = Partial<
  CallDeskSessionState & { fields: Partial<BookingFields> }
>;

@Injectable()
export class SessionStateService {
  private readonly sessionStore = new Map<string, CallDeskSessionState>();

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
      upsell_offered: state.upsell_offered,
      emergency_flagged: state.emergency_flagged,
      fields: state.fields,
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
      upsellOffered?: boolean;
      emergencyFlagged?: boolean;
    },
  ): CallDeskSessionState {
    const key = this.composeKey(tenantId, sessionId);
    const current = this.sessionStore.get(key) ?? this.createInitialState();
    const next: CallDeskSessionState = {
      ...current,
      category: payload.category ?? current.category,
      urgency: payload.urgency ?? current.urgency,
      fee_disclosed: payload.feeDisclosed ?? current.fee_disclosed,
      upsell_offered: payload.upsellOffered ?? current.upsell_offered,
      emergency_flagged:
        payload.emergencyFlagged ?? current.emergency_flagged,
      fields: {
        ...current.fields,
        ...(payload.fields ?? {}),
      },
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
      upsell_offered: false,
      emergency_flagged: false,
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
    const fieldsUpdate = extractBookingFields(message, state.fields);
    const category = detectCategory(message);
    const urgency = detectUrgency(message);
    const isEmergency = urgency === "EMERGENCY";
    const updated: CallDeskSessionState = {
      ...state,
      fields: { ...state.fields, ...fieldsUpdate },
      category: state.category ?? category ?? null,
      urgency: state.urgency ?? urgency ?? null,
      emergency_flagged: state.emergency_flagged || isEmergency,
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
    const updated = this.advanceStep({
      ...state,
      fee_disclosed: feeDisclosed,
      upsell_offered: upsell,
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
        return state.fee_disclosed ? "UPSELL" : "PRICING";
      case "UPSELL":
        return state.upsell_offered ? "BOOKING" : "UPSELL";
      case "BOOKING":
        return state.fee_disclosed ? "CLOSEOUT" : "BOOKING";
      case "CLOSEOUT":
        return "CLOSEOUT";
      default:
        return state.step;
    }
  }
}
