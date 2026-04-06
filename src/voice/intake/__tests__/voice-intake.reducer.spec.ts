import { reduceIssueSlot, type IssueSlotState } from "../voice-intake.reducer";

describe("voice intake issue-slot reducer", () => {
  it("prompts once when issue is still missing", () => {
    const initial: IssueSlotState = {
      status: "MISSING",
      value: null,
      askCount: 0,
    };
    const decision = reduceIssueSlot(initial, {
      existingIssue: null,
      detectedIssue: null,
      isQuestion: false,
    });

    expect(decision.action.type).toBe("PROMPT_ISSUE");
    expect(decision.nextState.askCount).toBe(1);
    expect(decision.nextState.status).toBe("MISSING");
  });

  it("defers to sms after one failed issue reprompt", () => {
    const afterFirstPrompt: IssueSlotState = {
      status: "MISSING",
      value: null,
      askCount: 1,
    };
    const decision = reduceIssueSlot(afterFirstPrompt, {
      existingIssue: null,
      detectedIssue: null,
      isQuestion: false,
    });

    expect(decision.action.type).toBe("DEFER_TO_SMS");
    expect(decision.nextState.askCount).toBe(1);
  });

  it("captures issue when detector finds one in the transcript", () => {
    const initial: IssueSlotState = {
      status: "MISSING",
      value: null,
      askCount: 1,
    };
    const decision = reduceIssueSlot(initial, {
      existingIssue: null,
      detectedIssue: "I just told you that Ben Banks, furnace blowing cold, air.",
      isQuestion: false,
    });

    expect(decision.action.type).toBe("CAPTURE_ISSUE");
    expect(decision.nextState.status).toBe("CAPTURED");
    expect(decision.nextState.askCount).toBe(0);
    expect(decision.nextState.value).toContain("furnace blowing cold");
  });

  it("does not reprompt when issue is already captured", () => {
    const state: IssueSlotState = {
      status: "CAPTURED",
      value: "furnace blowing cold air",
      askCount: 0,
    };
    const decision = reduceIssueSlot(state, {
      existingIssue: "furnace blowing cold air",
      detectedIssue: null,
      isQuestion: false,
    });

    expect(decision.action.type).toBe("ALREADY_CAPTURED");
    expect(decision.nextState.askCount).toBe(0);
    expect(decision.nextState.status).toBe("CAPTURED");
  });
});
