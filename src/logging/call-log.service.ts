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
  transcript: string;
  aiResponse?: string;
  direction?: "INBOUND" | "OUTBOUND";
  metadata?: Record<string, unknown>;
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
      direction: input.direction ?? "INBOUND",
      message: sanitizedTranscript,
      payload: metadataPayload,
    });

    if (sanitizedResponse) {
      await this.createCommunicationEvent({
        tenantId: input.tenantId,
        direction: "OUTBOUND",
        message: sanitizedResponse,
        payload: metadataPayload,
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

  async clearSession(tenantId: string, sessionId: string): Promise<void> {
    await this.createCommunicationEvent({
      tenantId,
      direction: "OUTBOUND",
      message: "",
      payload: {
        sessionId,
        type: "session_closed",
      },
    });
  }

  private async createCommunicationEvent({
    tenantId,
    direction,
    message,
    payload,
  }: {
    tenantId: string;
    direction: "INBOUND" | "OUTBOUND";
    message: string;
    payload: Prisma.InputJsonValue;
  }) {
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
        channel: CommunicationChannel.WEBCHAT,
        direction: direction as CommunicationDirection,
        provider: CommunicationProvider.OTHER,
        status:
          direction === "INBOUND"
            ? CommunicationStatus.RECEIVED
            : CommunicationStatus.SENT,
        CommunicationContent: {
          create: {
            id: contentId,
            tenantId,
            payload: normalizedPayload,
          },
        },
      },
    });
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
