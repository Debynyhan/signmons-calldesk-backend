export type VoiceTurnPlannerExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm"
  | null;

export type VoiceTurnPlannerState = {
  expectedField: VoiceTurnPlannerExpectedField;
  nameReady: boolean;
  addressReady: boolean;
  issueCaptured: boolean;
  emergencyRelevant: boolean;
  emergencyAsked: boolean;
  emergencyAnswered: boolean;
};

export type VoiceTurnPlannerInput = {
  isQuestion: boolean;
};

export type VoiceTurnPlannerAction =
  | { type: "NONE" }
  | {
      type: "WAIT_FOR_EXPECTED_FIELD";
      field: Exclude<VoiceTurnPlannerExpectedField, null>;
    }
  | { type: "ASK_NAME" }
  | { type: "ASK_ADDRESS" }
  | { type: "ASK_ISSUE" }
  | { type: "ASK_EMERGENCY" };

export function reduceVoiceTurnPlanner(
  state: VoiceTurnPlannerState,
  input: VoiceTurnPlannerInput,
): VoiceTurnPlannerAction {
  if (state.expectedField) {
    return {
      type: "WAIT_FOR_EXPECTED_FIELD",
      field: state.expectedField,
    };
  }
  if (!state.nameReady) {
    return { type: "ASK_NAME" };
  }
  if (!state.addressReady) {
    return { type: "ASK_ADDRESS" };
  }
  if (!state.issueCaptured) {
    if (input.isQuestion) {
      return { type: "NONE" };
    }
    return { type: "ASK_ISSUE" };
  }
  if (
    state.emergencyRelevant &&
    !state.emergencyAsked &&
    !state.emergencyAnswered
  ) {
    return { type: "ASK_EMERGENCY" };
  }
  return { type: "NONE" };
}
