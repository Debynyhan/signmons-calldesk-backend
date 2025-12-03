import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
    };

    return this.prisma.callLog.create({
      data: {
        tenantId: input.tenantId,
        jobId: input.jobId ?? null,
        direction: input.direction ?? "INBOUND",
        transcript: sanitizedTranscript,
        aiResponse: sanitizedResponse,
        metadata: metadataPayload,
      },
    });
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
    const logs = await this.prisma.callLog.findMany({
      where: {
        tenantId,
        metadata: {
          path: ["sessionId"],
          equals: sessionId,
        },
        sessionClosedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return logs
      .map((log) => [
        {
          role: "user" as const,
          content: log.transcript,
          createdAt: log.createdAt,
        },
        log.aiResponse
          ? ({
              role: "assistant" as const,
              content: log.aiResponse,
              createdAt: log.createdAt,
            } as const)
          : null,
      ])
      .flat()
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
    await this.prisma.callLog.updateMany({
      where: {
        tenantId,
        metadata: {
          path: ["sessionId"],
          equals: sessionId,
        },
        sessionClosedAt: null,
      },
      data: {
        sessionClosedAt: new Date(),
      },
    });
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
