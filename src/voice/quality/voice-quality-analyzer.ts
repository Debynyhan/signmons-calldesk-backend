export type VoiceTurnTimingRecord = {
  recordedAt?: string;
  sttFinalMs?: number | null;
  queueDelayMs?: number | null;
  turnLogicMs?: number;
  aiMs?: number;
  ttsMs?: number;
  twilioUpdateMs?: number;
  totalTurnMs?: number;
  reason?: string;
  latencyBreaches?: string[];
};

export type VoiceReplayMessage = {
  atMs: number;
  role: "user" | "assistant";
  message: string;
};

export type PromptRepeat = {
  prompt: string;
  count: number;
};

export type VoiceQualityAudit = {
  turnCount: number;
  firstResponseMs: number | null;
  p95TurnMs: number | null;
  maxTurnMs: number | null;
  slowTurnCount: number;
  topLatencyBreaches: Array<{ breach: string; count: number }>;
  userMessageCount: number;
  assistantMessageCount: number;
  pairedTurnCount: number;
  delayedReplyCount: number;
  maxReplyDelayMs: number | null;
  repeatedPromptCount: number;
  repeatedPrompts: PromptRepeat[];
  consecutiveAssistantDuplicateCount: number;
  endedCleanly: boolean;
  closingMentionsSmsLink: boolean;
  closingMentionsFee: boolean;
  qualityScore: number;
  recommendations: string[];
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index] ?? null;
}

function roundMs(value: number | null): number | null {
  if (typeof value !== "number") {
    return null;
  }
  return Math.round(value);
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferTurnTotalMs(turn: VoiceTurnTimingRecord): number | null {
  if (typeof turn.totalTurnMs === "number") {
    return Math.max(0, turn.totalTurnMs);
  }
  const fields = [
    turn.sttFinalMs,
    turn.queueDelayMs,
    turn.turnLogicMs,
    turn.ttsMs,
    turn.twilioUpdateMs,
  ];
  let total = 0;
  for (const field of fields) {
    if (typeof field === "number" && Number.isFinite(field)) {
      total += Math.max(0, field);
    }
  }
  return total > 0 ? total : null;
}

export function buildPromptRepeatList(messages: VoiceReplayMessage[]): PromptRepeat[] {
  const counts = new Map<string, { count: number; sample: string }>();
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    const normalized = normalizeText(message.message);
    if (!normalized || normalized.length < 8) {
      continue;
    }
    const looksLikePrompt =
      message.message.trim().endsWith("?") ||
      /issue|address|name|emergency|service fee|dispatch/i.test(message.message);
    if (!looksLikePrompt) {
      continue;
    }
    const current = counts.get(normalized);
    if (current) {
      current.count += 1;
      continue;
    }
    counts.set(normalized, { count: 1, sample: message.message.trim() });
  }
  return Array.from(counts.values())
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((entry) => ({ prompt: entry.sample, count: entry.count }));
}

export function pairedReplyDelaysMs(messages: VoiceReplayMessage[]): number[] {
  const delays: number[] = [];
  let pendingUserAtMs: number | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      if (pendingUserAtMs === null) {
        pendingUserAtMs = message.atMs;
      }
      continue;
    }
    if (message.role === "assistant" && pendingUserAtMs !== null) {
      delays.push(Math.max(0, message.atMs - pendingUserAtMs));
      pendingUserAtMs = null;
    }
  }
  return delays;
}

export function consecutiveAssistantDuplicates(
  messages: VoiceReplayMessage[],
): number {
  let count = 0;
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    if (previous.role !== "assistant" || current.role !== "assistant") {
      continue;
    }
    if (normalizeText(previous.message) === normalizeText(current.message)) {
      count += 1;
    }
  }
  return count;
}

export function scoreVoiceQuality(params: {
  firstResponseMs: number | null;
  p95TurnMs: number | null;
  delayedReplyCount: number;
  repeatedPromptCount: number;
  duplicateCount: number;
  endedCleanly: boolean;
  closingMentionsSmsLink: boolean;
}): number {
  let score = 100;
  if (params.firstResponseMs && params.firstResponseMs > 4500) {
    score -= 15;
  }
  if (params.p95TurnMs && params.p95TurnMs > 5000) {
    score -= 15;
  }
  score -= Math.min(20, params.delayedReplyCount * 5);
  score -= Math.min(24, params.repeatedPromptCount * 8);
  score -= Math.min(20, params.duplicateCount * 10);
  if (!params.closingMentionsSmsLink) {
    score -= 8;
  }
  if (!params.endedCleanly) {
    score -= 8;
  }
  return Math.max(0, score);
}

export function buildVoiceQualityRecommendations(
  audit: Pick<
    VoiceQualityAudit,
    | "firstResponseMs"
    | "p95TurnMs"
    | "delayedReplyCount"
    | "repeatedPromptCount"
    | "consecutiveAssistantDuplicateCount"
    | "endedCleanly"
    | "closingMentionsSmsLink"
  >,
): string[] {
  const recommendations: string[] = [];
  if (audit.firstResponseMs && audit.firstResponseMs > 4500) {
    recommendations.push(
      "First response is above target; keep first-turn prompts on Twilio <Say> and prewarm AI context.",
    );
  }
  if (audit.p95TurnMs && audit.p95TurnMs > 5000) {
    recommendations.push(
      "Turn p95 latency is high; inspect `voice.stream.turn_sla_warning` breaches for STT/AI/TTS bottlenecks.",
    );
  }
  if (
    audit.repeatedPromptCount > 0 ||
    audit.consecutiveAssistantDuplicateCount > 0
  ) {
    recommendations.push(
      "Repeated prompts detected; enforce slot lock once issue/address/emergency are captured.",
    );
  }
  if (audit.delayedReplyCount > 0) {
    recommendations.push(
      "Long user-to-assistant gaps detected; tune end-of-speech and pending-transcript queue thresholds.",
    );
  }
  if (!audit.closingMentionsSmsLink) {
    recommendations.push(
      "Closing handoff copy missing SMS/link confirmation; enforce a mandatory final handoff template.",
    );
  }
  if (!audit.endedCleanly) {
    recommendations.push(
      "Conversation did not close cleanly; verify Hangup and lifecycle completion persistence.",
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "No major regressions detected in this call. Continue monitoring with the same audit command.",
    );
  }
  return recommendations;
}

export function analyzeVoiceQualityReplay(params: {
  turnTimings: VoiceTurnTimingRecord[];
  messages: VoiceReplayMessage[];
  status: string;
  endedAt?: string | null;
}): VoiceQualityAudit {
  const turnTotals = params.turnTimings
    .map((turn) => inferTurnTotalMs(turn))
    .filter((value): value is number => typeof value === "number");
  const p95TurnMs = percentile(turnTotals, 0.95);
  const maxTurnMs = turnTotals.length > 0 ? Math.max(...turnTotals) : null;
  const topLatencyBreachesMap = new Map<string, number>();
  let slowTurnCount = 0;
  for (const turn of params.turnTimings) {
    const breaches = Array.isArray(turn.latencyBreaches)
      ? turn.latencyBreaches
      : [];
    if (breaches.length > 0) {
      slowTurnCount += 1;
    }
    for (const breach of breaches) {
      topLatencyBreachesMap.set(breach, (topLatencyBreachesMap.get(breach) ?? 0) + 1);
    }
  }
  const topLatencyBreaches = Array.from(topLatencyBreachesMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([breach, count]) => ({ breach, count }));
  const userMessages = params.messages.filter((message) => message.role === "user");
  const assistantMessages = params.messages.filter(
    (message) => message.role === "assistant",
  );
  const delays = pairedReplyDelaysMs(params.messages);
  const delayedReplyCount = delays.filter((delay) => delay > 8000).length;
  const maxReplyDelayMs = delays.length > 0 ? Math.max(...delays) : null;
  const firstResponseMs = asNumber(turnTotals[0]) ?? asNumber(delays[0]);
  const repeatedPrompts = buildPromptRepeatList(params.messages);
  const repeatedPromptCount = repeatedPrompts.reduce(
    (sum, entry) => sum + Math.max(0, entry.count - 1),
    0,
  );
  const duplicateCount = consecutiveAssistantDuplicates(params.messages);
  const endedCleanly = params.status !== "ONGOING" || Boolean(params.endedAt);
  const closingMessage = assistantMessages[assistantMessages.length - 1]?.message ?? "";
  const assistantCorpus = assistantMessages.map((entry) => entry.message).join(" ");
  const closingMentionsSmsLink = /text|sms|link/i.test(closingMessage);
  const closingMentionsFee = /\$ ?\d+|service fee|dispatch fee|125/i.test(
    assistantCorpus,
  );
  const qualityScore = scoreVoiceQuality({
    firstResponseMs,
    p95TurnMs,
    delayedReplyCount,
    repeatedPromptCount,
    duplicateCount,
    endedCleanly,
    closingMentionsSmsLink,
  });
  const recommendations = buildVoiceQualityRecommendations({
    firstResponseMs,
    p95TurnMs,
    delayedReplyCount,
    repeatedPromptCount,
    consecutiveAssistantDuplicateCount: duplicateCount,
    endedCleanly,
    closingMentionsSmsLink,
  });

  return {
    turnCount: params.turnTimings.length,
    firstResponseMs: roundMs(firstResponseMs),
    p95TurnMs: roundMs(p95TurnMs),
    maxTurnMs: roundMs(maxTurnMs),
    slowTurnCount,
    topLatencyBreaches,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    pairedTurnCount: delays.length,
    delayedReplyCount,
    maxReplyDelayMs: roundMs(maxReplyDelayMs),
    repeatedPromptCount,
    repeatedPrompts,
    consecutiveAssistantDuplicateCount: duplicateCount,
    endedCleanly,
    closingMentionsSmsLink,
    closingMentionsFee,
    qualityScore,
    recommendations,
  };
}
