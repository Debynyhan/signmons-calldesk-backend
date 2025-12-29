import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { CreateConversationDto } from "./dto/create-conversation.dto";

@Injectable()
export class ConversationsService {
  private readonly defaultState = "INTAKE";

  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
  ) {}

  async createConversation(dto: CreateConversationDto) {
    const tenantId = this.sanitizeTenantId(dto.tenantId);
    const customerId = this.sanitizeIdentifier(dto.customerId, "customerId");

    const customer = await this.prisma.customer.findUnique({
      where: { id_tenantId: { id: customerId, tenantId } },
      select: { id: true },
    });
    if (!customer) {
      throw new BadRequestException("Customer not found for tenant.");
    }

    const currentFSMState = this.normalizeState(dto.currentFSMState);
    const providerConversationId = this.normalizeOptionalText(
      dto.providerConversationId,
    );
    const twilioCallSid = this.normalizeOptionalText(dto.twilioCallSid);
    const twilioSmsSid = this.normalizeOptionalText(dto.twilioSmsSid);

    return this.prisma.conversation.create({
      data: {
        tenantId,
        customerId,
        customerTenantId: tenantId,
        channel: dto.channel,
        status: dto.status ?? "ONGOING",
        currentFSMState,
        collectedData:
          (dto.collectedData as Prisma.InputJsonValue | undefined) ?? null,
        providerConversationId,
        twilioCallSid,
        twilioSmsSid,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : new Date(),
      },
    });
  }

  async listConversations(tenantId: string) {
    const sanitizedTenantId = this.sanitizeTenantId(tenantId);
    return this.prisma.conversation.findMany({
      where: { tenantId: sanitizedTenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  private normalizeState(value?: string): string {
    if (!value) {
      return this.defaultState;
    }
    const sanitized = this.sanitizationService.sanitizeText(value);
    return sanitized || this.defaultState;
  }

  private normalizeOptionalText(value?: string | null): string | null {
    if (!value) {
      return null;
    }
    const sanitized = this.sanitizationService.sanitizeText(value);
    return sanitized.length ? sanitized : null;
  }

  private sanitizeTenantId(value: string): string {
    const sanitized = this.sanitizationService.sanitizeIdentifier(value);
    if (!sanitized) {
      throw new BadRequestException("Invalid tenant identifier.");
    }
    return sanitized;
  }

  private sanitizeIdentifier(value: string, label: string): string {
    const sanitized = this.sanitizationService.sanitizeIdentifier(value);
    if (!sanitized) {
      throw new BadRequestException(`Invalid ${label}.`);
    }
    return sanitized;
  }
}
