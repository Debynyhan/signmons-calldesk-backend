import { reduceVoiceTurnPlanner } from "../voice-turn-planner.reducer";

describe("voice turn planner reducer", () => {
  it("asks for name first when name is missing", () => {
    const action = reduceVoiceTurnPlanner(
      {
        expectedField: null,
        nameReady: false,
        addressReady: false,
        issueCaptured: false,
        emergencyRelevant: false,
        emergencyAsked: false,
        emergencyAnswered: false,
      },
      { isQuestion: false },
    );
    expect(action).toEqual({ type: "ASK_NAME" });
  });

  it("asks for address after name is ready", () => {
    const action = reduceVoiceTurnPlanner(
      {
        expectedField: null,
        nameReady: true,
        addressReady: false,
        issueCaptured: false,
        emergencyRelevant: false,
        emergencyAsked: false,
        emergencyAnswered: false,
      },
      { isQuestion: false },
    );
    expect(action).toEqual({ type: "ASK_ADDRESS" });
  });

  it("asks for issue after name/address are ready and issue is missing", () => {
    const action = reduceVoiceTurnPlanner(
      {
        expectedField: null,
        nameReady: true,
        addressReady: true,
        issueCaptured: false,
        emergencyRelevant: false,
        emergencyAsked: false,
        emergencyAnswered: false,
      },
      { isQuestion: false },
    );
    expect(action).toEqual({ type: "ASK_ISSUE" });
  });

  it("does not ask for issue on side-question turns", () => {
    const action = reduceVoiceTurnPlanner(
      {
        expectedField: null,
        nameReady: true,
        addressReady: true,
        issueCaptured: false,
        emergencyRelevant: false,
        emergencyAsked: false,
        emergencyAnswered: false,
      },
      { isQuestion: true },
    );
    expect(action).toEqual({ type: "NONE" });
  });

  it("asks emergency after issue is captured", () => {
    const action = reduceVoiceTurnPlanner(
      {
        expectedField: null,
        nameReady: true,
        addressReady: true,
        issueCaptured: true,
        emergencyRelevant: true,
        emergencyAsked: false,
        emergencyAnswered: false,
      },
      { isQuestion: false },
    );
    expect(action).toEqual({ type: "ASK_EMERGENCY" });
  });

  it("honors expected listening window before planner fallbacks", () => {
    const action = reduceVoiceTurnPlanner(
      {
        expectedField: "urgency_confirm",
        nameReady: true,
        addressReady: true,
        issueCaptured: true,
        emergencyRelevant: true,
        emergencyAsked: true,
        emergencyAnswered: false,
      },
      { isQuestion: false },
    );
    expect(action).toEqual({
      type: "WAIT_FOR_EXPECTED_FIELD",
      field: "urgency_confirm",
    });
  });
});
