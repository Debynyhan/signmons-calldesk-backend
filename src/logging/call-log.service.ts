import { randomUUID } from "crypto";
import { Injectable } from "@nestjs/common";
import {
  CommunicationChannel,
  CommunicationDirection,
  CommunicationProvider,
  CommunicationStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";

export interface CreateCallLogInput {
  tenantId: string;
  sessionId: string;
  jobId?: string;
  conversationId?: string;
  transcript: string;
  aiResponse?: string;
  direction?: "INBOUND" | "OUTBOUND";
  metadata?: Record<string, unknown>;
  channel?: CommunicationChannel;
}

@Injectable()
export class CallLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
  ) {}

  async createLog(input: CreateCallLogInput) {
    const sanitizedTranscript = this.obfuscatePii(
      this.sanitizationService.sanitizeText(input.transcript),
    );
    const sanitizedResponse = input.aiResponse
      ? this.obfuscatePii(
          this.sanitizationService.sanitizeText(input.aiResponse),
        )
      : null;

    const metadataPayload: Prisma.InputJsonValue = {
      ...(input.metadata ?? {}),
      sessionId: input.sessionId,
      jobId: input.jobId ?? null,
      type: "message",
    };

    await this.createCommunicationEvent({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: input.direction ?? "INBOUND",
      message: sanitizedTranscript,
      payload: metadataPayload,
      channel: input.channel,
    });

    if (sanitizedResponse) {
      await this.createCommunicationEvent({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        message: sanitizedResponse,
        payload: metadataPayload,
        channel: input.channel,
      });
    }
  }

  async getRecentMessages(
    tenantId: string,
    sessionId: string,
    limit = 10,
  ): Promise<
    Array<{
      role: "user" | "assistant";
      content: string;
      createdAt: Date;
    }>
  > {
    const lastClosedAt = await this.getLastSessionClosedAt(tenantId, sessionId);
    const logs = await this.prisma.communicationContent.findMany({
      where: {
        tenantId,
        createdAt: lastClosedAt ? { gt: lastClosedAt } : undefined,
        payload: {
          path: ["sessionId"],
          equals: sessionId,
        },
        AND: [
          {
            payload: {
              path: ["type"],
              equals: "message",
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return logs
      .map((log) => this.mapPayloadToMessage(log.payload, log.createdAt))
      .filter(
        (
          entry,
        ): entry is {
          role: "user" | "assistant";
          content: string;
          createdAt: Date;
        } => Boolean(entry),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async clearSession(
    tenantId: string,
    sessionId: string,
    conversationId?: string,
  ): Promise<void> {
    await this.createCommunicationEvent({
      tenantId,
      conversationId,
      direction: "OUTBOUND",
      message: "",
      payload: {
        sessionId,
        type: "session_closed",
      },
    });
  }

  async createVoiceTranscriptLog(input: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    transcript: string;
    confidence?: number;
    occurredAt?: Date;
  }): Promise<string | null> {
    const sanitizedTranscript = this.obfuscatePii(
      this.sanitizationService.sanitizeText(input.transcript),
    );
    if (!sanitizedTranscript) {
      return null;
    }

    const metadataPayload: Prisma.InputJsonValue = {
      type: "voice_transcript",
      callSid: input.callSid,
      transcript: sanitizedTranscript,
      confidence:
        typeof input.confidence === "number" ? input.confidence : null,
    };

    return this.createCommunicationEvent({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: "INBOUND",
      message: sanitizedTranscript,
      payload: metadataPayload,
      channel: CommunicationChannel.VOICE,
      provider: CommunicationProvider.TWILIO,
      externalId: input.callSid,
      occurredAt: input.occurredAt,
    });
  }

  async getVoiceTranscripts(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<
    Array<{
      transcript: string;
      confidence?: number;
      createdAt: Date;
    }>
  > {
    return this.mapVoiceTranscripts(
      await this.prisma.communicationContent.findMany({
        where: {
          tenantId: params.tenantId,
          communicationEvent: {
            conversationId: params.conversationId,
            channel: CommunicationChannel.VOICE,
          },
          payload: {
            path: ["type"],
            equals: "voice_transcript",
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          payload: true,
          createdAt: true,
        },
      }),
    );
  }

  private async createCommunicationEvent({
    tenantId,
    conversationId,
    direction,
    message,
    payload,
    channel = CommunicationChannel.WEBCHAT,
    provider = CommunicationProvider.OTHER,
    externalId,
    occurredAt,
  }: {
    tenantId: string;
    conversationId?: string;
    direction: "INBOUND" | "OUTBOUND";
    message: string;
    payload: Prisma.InputJsonValue;
    channel?: CommunicationChannel;
    provider?: CommunicationProvider;
    externalId?: string;
    occurredAt?: Date;
  }): Promise<string> {
    const eventId = randomUUID();
    const contentId = randomUUID();
    const normalizedPayload =
      payload && typeof payload === "object"
        ? {
            ...(payload as Record<string, unknown>),
            message,
            role: direction === "INBOUND" ? "user" : "assistant",
          }
        : {
            message,
            role: direction === "INBOUND" ? "user" : "assistant",
          };

    await this.prisma.communicationEvent.create({
      data: {
        id: eventId,
        tenantId,
        conversationId: conversationId ?? undefined,
        conversationTenantId: conversationId ? tenantId : undefined,
        channel,
        direction: direction as CommunicationDirection,
        provider,
        externalId: externalId ?? undefined,
        occurredAt: occurredAt ?? new Date(),
        status:
          direction === "INBOUND"
            ? CommunicationStatus.RECEIVED
            : CommunicationStatus.SENT,
        content: {
          create: {
            id: contentId,
            tenantId,
            payload: normalizedPayload,
          },
        },
      },
    });
    return eventId;
  }

  private async getLastSessionClosedAt(
    tenantId: string,
    sessionId: string,
  ): Promise<Date | null> {
    const marker = await this.prisma.communicationContent.findFirst({
      where: {
        tenantId,
        payload: {
          path: ["sessionId"],
          equals: sessionId,
        },
        AND: [
          {
            payload: {
              path: ["type"],
              equals: "session_closed",
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    return marker?.createdAt ?? null;
  }

  private mapPayloadToMessage(
    payload: Prisma.JsonValue,
    createdAt: Date,
  ):
    | { role: "user" | "assistant"; content: string; createdAt: Date }
    | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const data = payload as Record<string, unknown>;
    const role = data.role;
    const message = data.message;
    if (
      (role !== "user" && role !== "assistant") ||
      typeof message !== "string"
    ) {
      return null;
    }

    return { role, content: message, createdAt };
  }

  private mapVoiceTranscript(
    payload: Prisma.JsonValue,
    createdAt: Date,
  ): { transcript: string; confidence?: number; createdAt: Date } | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const data = payload as Record<string, unknown>;
    if (data.type !== "voice_transcript") {
      return null;
    }
    const transcript = data.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) {
      return null;
    }
    const confidence =
      typeof data.confidence === "number" ? data.confidence : undefined;
    return { transcript, confidence, createdAt };
  }

  private mapVoiceTranscripts(
    logs: Array<{ payload: Prisma.JsonValue; createdAt: Date }>,
  ): Array<{ transcript: string; confidence?: number; createdAt: Date }> {
    return logs
      .map((log) => this.mapVoiceTranscript(log.payload, log.createdAt))
      .filter(
        (entry): entry is { transcript: string; confidence?: number; createdAt: Date } =>
          Boolean(entry),
      );
  }

  private obfuscatePii(value: string): string {
    const maskedPhones = value.replace(
      /\b(\+?\d{1,3}[-.\s]?)?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
      (match) => {
        const digits = match.replace(/\D/g, "");
        if (digits.length < 4) {
          return "***";
        }
        const lastFour = digits.slice(-4);
        return `***-***-${lastFour}`;
      },
    );

    return maskedPhones.replace(
      /\b(\d{1,5}\s+[A-Za-z0-9\s]+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Terrace|Ter|Place|Pl|Trail|Trl)\b)/gi,
      (match) => {
        const parts = match.split(" ");
        if (parts.length < 2) {
          return "***";
        }
        const streetName = parts.slice(1).join(" ");
        return `*** ${streetName}`;
      },
    );
  }
}
