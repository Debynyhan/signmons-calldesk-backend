import { analyzeVoiceQualityReplay } from "../voice-quality-analyzer";
import {
  highQualityMultifieldFixture,
  repeatedIssuePromptFixture,
  slowFirstReplyFixture,
} from "./voice-quality.replay.fixtures";

describe("voice quality replay harness", () => {
  it("keeps high-quality multifield call flow green", () => {
    const audit = analyzeVoiceQualityReplay({
      status: highQualityMultifieldFixture.status,
      endedAt: highQualityMultifieldFixture.endedAt,
      turnTimings: highQualityMultifieldFixture.turnTimings,
      messages: highQualityMultifieldFixture.messages,
    });

    expect(audit.repeatedPromptCount).toBe(0);
    expect(audit.delayedReplyCount).toBe(0);
    expect(audit.consecutiveAssistantDuplicateCount).toBe(0);
    expect(audit.closingMentionsSmsLink).toBe(true);
    expect(audit.closingMentionsFee).toBe(true);
    expect(audit.endedCleanly).toBe(true);
    expect(audit.qualityScore).toBeGreaterThanOrEqual(90);
  });

  it("flags repeated issue prompts as a regression signal", () => {
    const audit = analyzeVoiceQualityReplay({
      status: repeatedIssuePromptFixture.status,
      endedAt: repeatedIssuePromptFixture.endedAt,
      turnTimings: repeatedIssuePromptFixture.turnTimings,
      messages: repeatedIssuePromptFixture.messages,
    });

    expect(audit.repeatedPromptCount).toBeGreaterThan(0);
    expect(
      audit.recommendations.some((entry) =>
        entry.toLowerCase().includes("repeated prompts detected"),
      ),
    ).toBe(true);
  });

  it("flags first-response latency and unclean lifecycle regressions", () => {
    const audit = analyzeVoiceQualityReplay({
      status: slowFirstReplyFixture.status,
      endedAt: slowFirstReplyFixture.endedAt,
      turnTimings: slowFirstReplyFixture.turnTimings,
      messages: slowFirstReplyFixture.messages,
    });

    expect(audit.firstResponseMs).toBeGreaterThan(4500);
    expect(audit.delayedReplyCount).toBeGreaterThan(0);
    expect(audit.endedCleanly).toBe(false);
    expect(audit.closingMentionsSmsLink).toBe(false);
    expect(audit.qualityScore).toBeLessThan(90);
    expect(
      audit.recommendations.some((entry) =>
        entry.toLowerCase().includes("first response is above target"),
      ),
    ).toBe(true);
  });
});
