import {
  ISSUE_SLOT_MAX_REPROMPTS,
} from "../issue-slot.policy";
import {
  reduceIssueSlot,
  type IssueSlotState,
} from "../voice-intake.reducer";

describe("voice intake issue-slot replay flows", () => {
  it("replays a missed-issue flow and defers to sms at policy threshold", () => {
    let state: IssueSlotState = {
      status: "MISSING",
      value: null,
      askCount: 0,
    };

    const firstTurn = reduceIssueSlot(state, {
      existingIssue: null,
      detectedIssue: null,
      isQuestion: false,
    });
    expect(firstTurn.action.type).toBe("PROMPT_ISSUE");
    state = firstTurn.nextState;
    expect(state.askCount).toBe(1);

    const secondTurn = reduceIssueSlot(state, {
      existingIssue: null,
      detectedIssue: null,
      isQuestion: false,
    });
    expect(secondTurn.action.type).toBe("DEFER_TO_SMS");
    expect(secondTurn.nextState.askCount).toBe(ISSUE_SLOT_MAX_REPROMPTS);
  });

  it("replays a multi-field opening and never reprompts issue after capture", () => {
    let state: IssueSlotState = {
      status: "MISSING",
      value: null,
      askCount: 0,
    };

    const openingTurn = reduceIssueSlot(state, {
      existingIssue: null,
      detectedIssue: "furnace is blowing cold air",
      isQuestion: false,
    });
    expect(openingTurn.action.type).toBe("CAPTURE_ISSUE");
    state = openingTurn.nextState;
    expect(state.status).toBe("CAPTURED");
    expect(state.askCount).toBe(0);

    const followUpTurn = reduceIssueSlot(state, {
      existingIssue: "furnace is blowing cold air",
      detectedIssue: null,
      isQuestion: false,
    });
    expect(followUpTurn.action.type).toBe("ALREADY_CAPTURED");
    expect(followUpTurn.nextState.askCount).toBe(0);
    expect(followUpTurn.nextState.status).toBe("CAPTURED");
  });
});
