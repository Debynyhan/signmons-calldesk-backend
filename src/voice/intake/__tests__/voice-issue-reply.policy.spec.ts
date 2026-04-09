import {
  capVoiceAiReply,
  isVoiceIssueCollectionPrompt,
  isVoiceIssueReconfirmationPrompt,
  shouldVoiceGatherMore,
} from "../voice-issue-reply.policy";

const normalize = (value: string) => value.toLowerCase().trim();

describe("voice-issue-reply.policy", () => {
  it("caps long ai replies and applies fallback text", () => {
    expect(capVoiceAiReply("")).toBe("Thanks. We'll follow up shortly.");
    expect(capVoiceAiReply("  ok  ")).toBe("ok");
    expect(capVoiceAiReply("x".repeat(600))).toHaveLength(503);
  });

  it("detects question-shaped ai prompts", () => {
    expect(shouldVoiceGatherMore("Can you confirm the address?")).toBe(true);
    expect(shouldVoiceGatherMore("Thanks, we're all set.")).toBe(false);
  });

  it("detects issue collection prompts", () => {
    expect(
      isVoiceIssueCollectionPrompt(
        "What seems to be the issue with the system?",
        normalize,
      ),
    ).toBe(true);
    expect(
      isVoiceIssueCollectionPrompt("Would you like to book a visit?", normalize),
    ).toBe(false);
  });

  it("detects issue reconfirmation prompts", () => {
    expect(
      isVoiceIssueReconfirmationPrompt(
        "It sounds like you're dealing with a heating issue, is that right?",
        normalize,
      ),
    ).toBe(true);
    expect(
      isVoiceIssueReconfirmationPrompt(
        "Would you like to proceed with booking?",
        normalize,
      ),
    ).toBe(false);
  });
});
