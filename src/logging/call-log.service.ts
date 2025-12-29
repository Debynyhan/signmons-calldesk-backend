import { Injectable } from "@nestjs/common";
import type {
  CommunicationDirection,
  CommunicationEvent,
  Conversation,
  Customer,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";

export interface CreateCallLogInput {
  tenantId: string;
  sessionId: string;
  jobId?: string;
  transcript: string;
  aiResponse?: string;
  direction?: CommunicationDirection;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class CallLogService {
  private readonly defaultChannel = "WEBCHAT";

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

    const conversation = await this.ensureConversation(
      input.tenantId,
      input.sessionId,
    );

    const inbound = await this.createCommunicationEvent({
      tenantId: input.tenantId,
      conversation,
      jobId: input.jobId,
      direction: input.direction ?? "INBOUND",
      content: sanitizedTranscript,
      metadata: metadataPayload,
      status: "RECEIVED",
    });

    if (sanitizedResponse) {
      await this.createCommunicationEvent({
        tenantId: input.tenantId,
        conversation,
        jobId: input.jobId,
        direction: "OUTBOUND",
        content: sanitizedResponse,
        metadata: metadataPayload,
        status: "SENT",
      });
    }

    await this.prisma.conversation.update({
      where: {
        id_tenantId: {
          id: conversation.id,
          tenantId: input.tenantId,
        },
      },
      data: {
        status: "ONGOING",
      },
    });

    return inbound;
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
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId,
        providerConversationId: sessionId,
      },
    });

    if (!conversation) {
      return [];
    }

    const events = await this.prisma.communicationEvent.findMany({
      where: {
        tenantId,
        conversationId: conversation.id,
        conversationTenantId: tenantId,
      },
      orderBy: { occurredAt: "desc" },
      take: limit,
      include: { content: true },
    });

    return events
      .map((event) => {
        const content = this.extractContent(event);
        if (!content) {
          return null;
        }
        return {
          role: event.direction === "INBOUND" ? "user" : "assistant",
          content,
          createdAt: event.occurredAt,
        } as const;
      })
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
    await this.prisma.conversation.updateMany({
      where: {
        tenantId,
        providerConversationId: sessionId,
        status: "ONGOING",
      },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
      },
    });
  }

  private async ensureConversation(
    tenantId: string,
    sessionId: string,
  ): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        tenantId,
        providerConversationId: sessionId,
      },
    });
    if (existing) {
      return existing;
    }

    const customer = await this.getOrCreatePlaceholderCustomer(
      tenantId,
      sessionId,
    );

    return this.prisma.conversation.create({
      data: {
        tenantId,
        customerId: customer.id,
        customerTenantId: tenantId,
        channel: this.defaultChannel,
        status: "ONGOING",
        currentFSMState: "INTAKE",
        collectedData: {},
        providerConversationId: sessionId,
        startedAt: new Date(),
      },
    });
  }

  private async getOrCreatePlaceholderCustomer(
    tenantId: string,
    sessionId: string,
  ): Promise<Customer> {
    const phone = `unknown-${sessionId}`;
    return this.prisma.customer.upsert({
      where: {
        tenantId_phone: {
          tenantId,
          phone,
        },
      },
      update: {
        fullName: "Unknown Caller",
      },
      create: {
        tenantId,
        phone,
        fullName: "Unknown Caller",
        consentToText: false,
        marketingOptIn: false,
      },
    });
  }

  private async createCommunicationEvent(input: {
    tenantId: string;
    conversation: Conversation;
    jobId?: string;
    direction: CommunicationDirection;
    content: string;
    metadata: Prisma.InputJsonValue;
    status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | "RECEIVED";
  }): Promise<CommunicationEvent> {
    const event = await this.prisma.communicationEvent.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversation.id,
        conversationTenantId: input.tenantId,
        jobId: input.jobId ?? null,
        jobTenantId: input.jobId ? input.tenantId : null,
        channel: input.conversation.channel,
        direction: input.direction,
        provider: "OTHER",
        externalId: null,
        status: input.status,
        redactionLevel: "PARTIAL",
        occurredAt: new Date(),
      },
    });

    await this.prisma.communicationContent.create({
      data: {
        tenantId: input.tenantId,
        communicationEventId: event.id,
        communicationEventTenantId: input.tenantId,
        payload: {
          text: input.content,
          metadata: input.metadata,
        },
      },
    });

    return event;
  }

  private extractContent(
    event: CommunicationEvent & { content?: { payload: unknown } | null },
  ): string | null {
    const payload = event.content?.payload;
    if (typeof payload === "string") {
      return payload;
    }
    if (payload && typeof payload === "object" && "text" in payload) {
      const value = (payload as { text?: unknown }).text;
      return typeof value === "string" ? value : null;
    }
    return null;
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
