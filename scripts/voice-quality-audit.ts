import { ConversationChannel, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  analyzeVoiceQualityReplay,
  type VoiceReplayMessage,
  type VoiceTurnTimingRecord,
} from "../src/voice/quality/voice-quality-analyzer";

type CliArgs = {
  tenantId?: string;
  callSid?: string;
  conversationId?: string;
  limit: number;
  json: boolean;
};

type MessageRecord = VoiceReplayMessage;

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
  repeatedPrompts: Array<{ prompt: string; count: number }>;
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
      atMs: (row.communicationEvent.occurredAt ?? row.createdAt).getTime(),
      role,
      message,
    });
  }
  return messages.sort((a, b) => a.atMs - b.atMs);
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
  const replayAudit = analyzeVoiceQualityReplay({
    turnTimings,
    messages,
    status: conversation.status,
    endedAt: conversation.endedAt ? conversation.endedAt.toISOString() : null,
  });

  const audit: ConversationAudit = {
    conversationId: conversation.id,
    tenantId: conversation.tenantId,
    callSid: conversation.twilioCallSid,
    status: conversation.status,
    startedAt: conversation.startedAt.toISOString(),
    endedAt: conversation.endedAt ? conversation.endedAt.toISOString() : null,
    ...replayAudit,
  };
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
