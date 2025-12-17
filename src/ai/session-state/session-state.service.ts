import { Injectable } from "@nestjs/common";

export type DispatcherStep =
  | "GREETING"
  | "CATEGORY"
  | "URGENCY"
  | "INFO_COLLECTION"
  | "PRICING"
  | "UPSELL"
  | "BOOKING";

export interface SessionState {
  currentStep: DispatcherStep;
  category: string | null;
  urgency: string | null;
  feeDisclosed: boolean;
  upsellOffered: boolean;
  emergencyFlagged: boolean;
  requiredFields: {
    customerName: boolean;
    phoneNumber: boolean;
    issueSummary: boolean;
    serviceAddress: boolean;
    preferredWindow: boolean;
    photos: boolean;
  };
  metadata: Record<string, unknown>;
}

type PartialStateUpdate = Partial<
  SessionState & { requiredFields: Partial<SessionState["requiredFields"]> }
>;

@Injectable()
export class SessionStateService {
  private readonly sessionStore = new Map<string, SessionState>();

  getState(tenantId: string, sessionId: string): SessionState {
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
  ): SessionState {
    const key = this.composeKey(tenantId, sessionId);
    const current = this.sessionStore.get(key) ?? this.createInitialState();
    const next: SessionState = {
      ...current,
      ...updates,
      requiredFields: {
        ...current.requiredFields,
        ...(updates.requiredFields ?? {}),
      },
    };
    this.sessionStore.set(key, next);
    return this.cloneState(next);
  }

  resetState(tenantId: string, sessionId: string): void {
    const key = this.composeKey(tenantId, sessionId);
    this.sessionStore.delete(key);
  }

  getPromptState(tenantId: string, sessionId: string): Record<string, unknown> {
    const state = this.getState(tenantId, sessionId);
    return {
      currentStep: state.currentStep,
      category: state.category,
      urgency: state.urgency,
      feeDisclosed: state.feeDisclosed,
      upsellOffered: state.upsellOffered,
      emergencyFlagged: state.emergencyFlagged,
      requiredFields: state.requiredFields,
    };
  }

  private composeKey(tenantId: string, sessionId: string): string {
    return `${tenantId}:${sessionId}`;
  }

  private createInitialState(): SessionState {
    return {
      currentStep: "GREETING",
      category: null,
      urgency: null,
      feeDisclosed: false,
      upsellOffered: false,
      emergencyFlagged: false,
      requiredFields: {
        customerName: false,
        phoneNumber: false,
        issueSummary: false,
        serviceAddress: false,
        preferredWindow: false,
        photos: false,
      },
      metadata: {},
    };
  }

  private cloneState(state: SessionState): SessionState {
    return {
      ...state,
      requiredFields: { ...state.requiredFields },
      metadata: { ...state.metadata },
    };
  }
}
