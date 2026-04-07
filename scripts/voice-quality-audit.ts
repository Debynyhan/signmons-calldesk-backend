import { ConversationChannel, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

type CliArgs = {
  tenantId?: string;
  callSid?: string;
  conversationId?: string;
  limit: number;
  json: boolean;
};

type VoiceTurnTimingRecord = {
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

type MessageRecord = {
  at: Date;
  role: "user" | "assistant";
  message: string;
};

type PromptRepeat = {
  prompt: string;
  count: number;
};

type ConversationAudit = {
  conversationId: string;
  tenantId: string;
  callSid: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
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

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    limit: 1,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--tenantId" && next) {
      args.tenantId = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--tenantId=")) {
      args.tenantId = token.split("=")[1];
      continue;
    }
    if (token === "--callSid" && next) {
      args.callSid = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--callSid=")) {
      args.callSid = token.split("=")[1];
      continue;
    }
    if (token === "--conversationId" && next) {
      args.conversationId = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--conversationId=")) {
      args.conversationId = token.split("=")[1];
      continue;
    }
    if (token === "--limit" && next) {
      args.limit = Number(next) || args.limit;
      index += 1;
      continue;
    }
    if (token.startsWith("--limit=")) {
      args.limit = Number(token.split("=")[1]) || args.limit;
    }
  }

  args.limit = Math.max(1, Math.min(20, Math.floor(args.limit)));
  return args;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run voice:audit -- [--tenantId=<uuid>] [--callSid=<sid>] [--conversationId=<uuid>] [--limit=<n>] [--json]",
    "",
    "Examples:",
    "  npm run voice:audit -- --callSid=CA123",
    "  npm run voice:audit -- --tenantId=<tenant-uuid> --limit=3",
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index] ?? null;
}

function parseVoiceTurnTimings(
  collectedData: unknown,
): VoiceTurnTimingRecord[] {
  const root = asRecord(collectedData);
  if (!root) {
    return [];
  }
  const raw = root.voiceTurnTimings;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }
      const latencyBreachesRaw = Array.isArray(record.latencyBreaches)
        ? record.latencyBreaches.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      return {
        recordedAt: asString(record.recordedAt) ?? undefined,
        sttFinalMs: asNumber(record.sttFinalMs),
        queueDelayMs: asNumber(record.queueDelayMs),
        turnLogicMs: asNumber(record.turnLogicMs) ?? undefined,
        aiMs: asNumber(record.aiMs) ?? undefined,
        ttsMs: asNumber(record.ttsMs) ?? undefined,
        twilioUpdateMs: asNumber(record.twilioUpdateMs) ?? undefined,
        totalTurnMs: asNumber(record.totalTurnMs) ?? undefined,
        reason: asString(record.reason) ?? undefined,
        latencyBreaches: latencyBreachesRaw,
      };
    })
    .filter((entry): entry is VoiceTurnTimingRecord => Boolean(entry));
}

function inferTurnTotalMs(turn: VoiceTurnTimingRecord): number | null {
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

function parseMessages(
  rows: Array<{
    createdAt: Date;
    payload: unknown;
    communicationEvent: { direction: "INBOUND" | "OUTBOUND"; occurredAt: Date };
  }>,
): MessageRecord[] {
  const messages: MessageRecord[] = [];
  for (const row of rows) {
    const payload = asRecord(row.payload);
    if (!payload) {
      continue;
    }
    const message = asString(payload.message);
    if (!message) {
      continue;
    }
    const roleValue = asString(payload.role);
    const role: "user" | "assistant" =
      roleValue === "assistant"
        ? "assistant"
        : roleValue === "user"
          ? "user"
          : row.communicationEvent.direction === "INBOUND"
            ? "user"
            : "assistant";
    messages.push({
      at: row.communicationEvent.occurredAt ?? row.createdAt,
      role,
      message,
    });
  }
  return messages.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function buildPromptRepeatList(messages: MessageRecord[]): PromptRepeat[] {
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

function pairedReplyDelaysMs(messages: MessageRecord[]): number[] {
  const delays: number[] = [];
  let pendingUserAt: Date | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      if (!pendingUserAt) {
        pendingUserAt = message.at;
      }
      continue;
    }
    if (message.role === "assistant" && pendingUserAt) {
      delays.push(Math.max(0, message.at.getTime() - pendingUserAt.getTime()));
      pendingUserAt = null;
    }
  }
  return delays;
}

function consecutiveAssistantDuplicates(messages: MessageRecord[]): number {
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

function roundMs(value: number | null): number | null {
  if (typeof value !== "number") {
    return null;
  }
  return Math.round(value);
}

function scoreQuality(params: {
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

function buildRecommendations(audit: ConversationAudit): string[] {
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
  if (audit.repeatedPromptCount > 0 || audit.consecutiveAssistantDuplicateCount > 0) {
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

async function analyzeConversation(params: {
  prisma: PrismaClient;
  conversation: {
    id: string;
    tenantId: string;
    twilioCallSid: string | null;
    status: string;
    startedAt: Date;
    endedAt: Date | null;
    collectedData: unknown;
  };
}): Promise<ConversationAudit> {
  const { prisma, conversation } = params;
  const turnTimings = parseVoiceTurnTimings(conversation.collectedData);
  const turnTotals = turnTimings
    .map((turn) => inferTurnTotalMs(turn))
    .filter((value): value is number => typeof value === "number");
  const p95TurnMs = percentile(turnTotals, 0.95);
  const maxTurnMs =
    turnTotals.length > 0 ? Math.max(...turnTotals) : null;

  const topLatencyBreachesMap = new Map<string, number>();
  let slowTurnCount = 0;
  for (const turn of turnTimings) {
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

  const contentRows = await prisma.communicationContent.findMany({
    where: {
      tenantId: conversation.tenantId,
      communicationEvent: {
        conversationId: conversation.id,
        channel: "VOICE",
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      payload: true,
      communicationEvent: {
        select: {
          direction: true,
          occurredAt: true,
        },
      },
    },
  });
  const messages = parseMessages(contentRows);
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const userMessages = messages.filter((message) => message.role === "user");
  const delays = pairedReplyDelaysMs(messages);
  const delayedReplyCount = delays.filter((delay) => delay > 8000).length;
  const maxReplyDelayMs =
    delays.length > 0 ? Math.max(...delays) : null;
  const firstResponseMs = turnTotals[0] ?? delays[0] ?? null;
  const repeatedPrompts = buildPromptRepeatList(messages);
  const repeatedPromptCount = repeatedPrompts.reduce(
    (sum, entry) => sum + Math.max(0, entry.count - 1),
    0,
  );
  const duplicateCount = consecutiveAssistantDuplicates(messages);
  const endedCleanly =
    conversation.status !== "ONGOING" || Boolean(conversation.endedAt);
  const closingMessage = assistantMessages[assistantMessages.length - 1]?.message ?? "";
  const assistantCorpus = assistantMessages.map((entry) => entry.message).join(" ");
  const closingMentionsSmsLink = /text|sms|link/i.test(closingMessage);
  const closingMentionsFee = /\$ ?\d+|service fee|dispatch fee|125/i.test(
    assistantCorpus,
  );

  const qualityScore = scoreQuality({
    firstResponseMs,
    p95TurnMs,
    delayedReplyCount,
    repeatedPromptCount,
    duplicateCount,
    endedCleanly,
    closingMentionsSmsLink,
  });

  const audit: ConversationAudit = {
    conversationId: conversation.id,
    tenantId: conversation.tenantId,
    callSid: conversation.twilioCallSid,
    status: conversation.status,
    startedAt: conversation.startedAt.toISOString(),
    endedAt: conversation.endedAt ? conversation.endedAt.toISOString() : null,
    turnCount: turnTimings.length,
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
    recommendations: [],
  };
  audit.recommendations = buildRecommendations(audit);
  return audit;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    // eslint-disable-next-line no-console
    console.log(usage());
    return;
  }
  const args = parseArgs(argv);
  const databaseUrl =
    process.env.DATABASE_URL ?? process.env.DB_URL_NO_SCHEMA ?? null;
  if (!databaseUrl) {
    // eslint-disable-next-line no-console
    console.error(
      "Missing DATABASE_URL (or DB_URL_NO_SCHEMA). Export it before running voice:audit.",
    );
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: ["warn", "error"],
  });

  try {
    const whereByContext = args.conversationId
      ? {
          id: args.conversationId,
          channel: ConversationChannel.VOICE,
          ...(args.tenantId ? { tenantId: args.tenantId } : {}),
        }
      : args.callSid
        ? {
            twilioCallSid: args.callSid,
            channel: ConversationChannel.VOICE,
            ...(args.tenantId ? { tenantId: args.tenantId } : {}),
          }
        : {
            channel: ConversationChannel.VOICE,
            twilioCallSid: { not: null },
            ...(args.tenantId ? { tenantId: args.tenantId } : {}),
          };

    const conversations = await prisma.conversation.findMany({
      where: whereByContext,
      orderBy: { startedAt: "desc" },
      take: args.conversationId ? 1 : args.limit,
      select: {
        id: true,
        tenantId: true,
        twilioCallSid: true,
        status: true,
        startedAt: true,
        endedAt: true,
        collectedData: true,
      },
    });

    if (conversations.length === 0) {
      // eslint-disable-next-line no-console
      console.error("No matching voice conversations found.");
      process.exitCode = 1;
      return;
    }

    const audits: ConversationAudit[] = [];
    for (const conversation of conversations) {
      audits.push(await analyzeConversation({ prisma, conversation }));
    }

    if (args.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(audits, null, 2));
      return;
    }

    for (const audit of audits) {
      // eslint-disable-next-line no-console
      console.log(
        [
          "",
          `Conversation ${audit.conversationId}`,
          `  tenantId: ${audit.tenantId}`,
          `  callSid: ${audit.callSid ?? "n/a"}`,
          `  status: ${audit.status} (endedCleanly=${audit.endedCleanly})`,
          `  startedAt: ${audit.startedAt}`,
          `  endedAt: ${audit.endedAt ?? "n/a"}`,
          `  qualityScore: ${audit.qualityScore}/100`,
          `  turns: count=${audit.turnCount}, firstResponseMs=${audit.firstResponseMs ?? "n/a"}, p95TurnMs=${audit.p95TurnMs ?? "n/a"}, maxTurnMs=${audit.maxTurnMs ?? "n/a"}, slowTurns=${audit.slowTurnCount}`,
          `  flow: userMsgs=${audit.userMessageCount}, assistantMsgs=${audit.assistantMessageCount}, pairedTurns=${audit.pairedTurnCount}, delayedReplies(>8s)=${audit.delayedReplyCount}, maxReplyDelayMs=${audit.maxReplyDelayMs ?? "n/a"}`,
          `  repetition: repeatedPrompts=${audit.repeatedPromptCount}, consecutiveAssistantDuplicates=${audit.consecutiveAssistantDuplicateCount}`,
          `  closure: mentionsSmsLink=${audit.closingMentionsSmsLink}, mentionsFee=${audit.closingMentionsFee}`,
        ].join("\n"),
      );

      if (audit.topLatencyBreaches.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `  topLatencyBreaches: ${audit.topLatencyBreaches
            .map((entry) => `${entry.breach}(${entry.count})`)
            .join(", ")}`,
        );
      }
      if (audit.repeatedPrompts.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `  repeatedPromptsList: ${audit.repeatedPrompts
            .map((entry) => `"${entry.prompt}" x${entry.count}`)
            .join(" | ")}`,
        );
      }
      // eslint-disable-next-line no-console
      console.log("  recommendations:");
      for (const recommendation of audit.recommendations) {
        // eslint-disable-next-line no-console
        console.log(`    - ${recommendation}`);
      }
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("voice-quality-audit failed.", error);
    process.exitCode = 1;
  });
