import { ISSUE_SLOT_MAX_REPROMPTS } from "./issue-slot.policy";

export type IssueSlotState = {
  status: "MISSING" | "CAPTURED";
  value: string | null;
  askCount: number;
};

export type IssueSlotInput = {
  existingIssue: string | null;
  detectedIssue: string | null;
  isQuestion: boolean;
};

export type IssueSlotAction =
  | { type: "NONE" }
  | { type: "ALREADY_CAPTURED" }
  | { type: "CAPTURE_ISSUE"; value: string }
  | { type: "PROMPT_ISSUE" }
  | { type: "DEFER_TO_SMS" };

export type IssueSlotDecision = {
  nextState: IssueSlotState;
  action: IssueSlotAction;
};

export function reduceIssueSlot(
  state: IssueSlotState,
  input: IssueSlotInput,
): IssueSlotDecision {
  if (input.existingIssue || state.status === "CAPTURED") {
    return {
      nextState: {
        status: "CAPTURED",
        value: input.existingIssue ?? state.value,
        askCount: 0,
      },
      action: { type: "ALREADY_CAPTURED" },
    };
  }

  if (input.detectedIssue) {
    return {
      nextState: {
        status: "CAPTURED",
        value: input.detectedIssue,
        askCount: 0,
      },
      action: { type: "CAPTURE_ISSUE", value: input.detectedIssue },
    };
  }

  if (input.isQuestion) {
    return {
      nextState: state,
      action: { type: "NONE" },
    };
  }

  if (state.askCount >= ISSUE_SLOT_MAX_REPROMPTS) {
    return {
      nextState: {
        ...state,
        askCount: state.askCount,
      },
      action: { type: "DEFER_TO_SMS" },
    };
  }

  return {
    nextState: {
      ...state,
      askCount: state.askCount + 1,
    },
    action: { type: "PROMPT_ISSUE" },
  };
}
