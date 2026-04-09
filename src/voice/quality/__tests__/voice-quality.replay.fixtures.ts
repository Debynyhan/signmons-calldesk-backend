import type {
  VoiceReplayMessage,
  VoiceTurnTimingRecord,
} from "../voice-quality-analyzer";

export type VoiceReplayFixture = {
  id: string;
  status: string;
  endedAt: string | null;
  turnTimings: VoiceTurnTimingRecord[];
  messages: VoiceReplayMessage[];
};

export const highQualityMultifieldFixture: VoiceReplayFixture = {
  id: "high-quality-multifield",
  status: "COMPLETED",
  endedAt: "2026-04-09T16:12:00.000Z",
  turnTimings: [
    { totalTurnMs: 3200 },
    { totalTurnMs: 2600 },
    { totalTurnMs: 2100 },
    { totalTurnMs: 1900 },
  ],
  messages: [
    {
      atMs: 0,
      role: "assistant",
      message: "Thank you for calling Leizurely HVAC. How may I help you today?",
    },
    {
      atMs: 1200,
      role: "user",
      message:
        "Hi this is Dean Banks and my furnace is blowing cold air in the house.",
    },
    {
      atMs: 2800,
      role: "assistant",
      message:
        "Thanks, Dean. I heard your furnace issue. What's the service address?",
    },
    {
      atMs: 4600,
      role: "user",
      message: "20991 Recher Ave, Euclid, Ohio 44119.",
    },
    {
      atMs: 6100,
      role: "assistant",
      message: "Is this an emergency right now?",
    },
    {
      atMs: 7000,
      role: "user",
      message: "No.",
    },
    {
      atMs: 8600,
      role: "assistant",
      message:
        "Great, the service fee is $125 and it's credited toward repairs within 24 hours. I'm texting you now with a secure link to confirm details and payment.",
    },
  ],
};

export const repeatedIssuePromptFixture: VoiceReplayFixture = {
  id: "repeated-issue-prompt",
  status: "COMPLETED",
  endedAt: "2026-04-09T16:18:00.000Z",
  turnTimings: [
    { totalTurnMs: 4100 },
    { totalTurnMs: 4300 },
    { totalTurnMs: 3800 },
  ],
  messages: [
    {
      atMs: 0,
      role: "assistant",
      message: "How may I help you today?",
    },
    {
      atMs: 1500,
      role: "user",
      message: "My heat is not working and my name is Dean Banks.",
    },
    {
      atMs: 3000,
      role: "assistant",
      message: "Can you briefly describe the issue you're having?",
    },
    {
      atMs: 4600,
      role: "user",
      message: "The furnace is still blowing cold air.",
    },
    {
      atMs: 6100,
      role: "assistant",
      message: "Can you briefly describe the issue you're having?",
    },
    {
      atMs: 7800,
      role: "user",
      message: "The exact same furnace issue.",
    },
    {
      atMs: 9300,
      role: "assistant",
      message:
        "Thanks. I'm texting you now to confirm details and payment.",
    },
  ],
};

export const slowFirstReplyFixture: VoiceReplayFixture = {
  id: "slow-first-reply",
  status: "ONGOING",
  endedAt: null,
  turnTimings: [{ totalTurnMs: 6200 }, { totalTurnMs: 3100 }],
  messages: [
    {
      atMs: 0,
      role: "assistant",
      message: "How may I help you today?",
    },
    {
      atMs: 1000,
      role: "user",
      message: "My AC is leaking and I need someone today.",
    },
    {
      atMs: 10800,
      role: "assistant",
      message: "Thanks. What's the service address?",
    },
    {
      atMs: 13000,
      role: "user",
      message: "20991 Recher Ave Euclid Ohio 44119.",
    },
    {
      atMs: 15000,
      role: "assistant",
      message:
        "Understood. We'll send a confirmation shortly.",
    },
  ],
};
