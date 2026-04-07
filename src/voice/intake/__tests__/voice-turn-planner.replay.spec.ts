import { reduceVoiceTurnPlanner } from "../voice-turn-planner.reducer";

describe("voice turn planner replay", () => {
  it("replays deterministic slot order without repeated asks", () => {
    const start = reduceVoiceTurnPlanner(
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
    expect(start.type).toBe("ASK_NAME");

    const afterName = reduceVoiceTurnPlanner(
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
    expect(afterName.type).toBe("ASK_ADDRESS");

    const afterAddressQuestion = reduceVoiceTurnPlanner(
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
    expect(afterAddressQuestion.type).toBe("NONE");

    const afterAddressStatement = reduceVoiceTurnPlanner(
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
    expect(afterAddressStatement.type).toBe("ASK_ISSUE");

    const afterIssue = reduceVoiceTurnPlanner(
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
    expect(afterIssue.type).toBe("ASK_EMERGENCY");

    const afterEmergencyAnswer = reduceVoiceTurnPlanner(
      {
        expectedField: null,
        nameReady: true,
        addressReady: true,
        issueCaptured: true,
        emergencyRelevant: true,
        emergencyAsked: true,
        emergencyAnswered: true,
      },
      { isQuestion: false },
    );
    expect(afterEmergencyAnswer.type).toBe("NONE");
  });
});
