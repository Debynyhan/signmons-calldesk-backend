import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ConversationsService } from "./conversations.service";
import { CreateConversationDto } from "./dto/create-conversation.dto";
import { ConversationResponseDto } from "./dto/conversation-response.dto";
import { ListConversationsQueryDto } from "./dto/list-conversations-query.dto";
import { FirebaseAuthGuard } from "../auth/firebase-auth.guard";
import { TenantGuard } from "../common/guards/tenant.guard";
import type { Request } from "express";
import type { AuthenticatedUser } from "../auth/firebase-auth.guard";

@Controller("conversations")
@UseGuards(FirebaseAuthGuard, TenantGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  async createConversation(
    @Body() dto: CreateConversationDto,
    @Req() request: Request,
  ): Promise<ConversationResponseDto> {
    const authUser = (request as Request & { authUser?: AuthenticatedUser })
      .authUser;
    const tenantId = authUser?.tenantId ?? dto.tenantId;
    const conversation = await this.conversationsService.createConversation({
      ...dto,
      tenantId,
    });
    return this.toConversationResponse(conversation);
  }

  @Get()
  async listConversations(
    @Query() query: ListConversationsQueryDto,
    @Req() request: Request,
  ): Promise<ConversationResponseDto[]> {
    const authUser = (request as Request & { authUser?: AuthenticatedUser })
      .authUser;
    const tenantId = authUser?.tenantId ?? query.tenantId;
    const conversations =
      await this.conversationsService.listConversations(tenantId);
    return conversations.map((conversation) =>
      this.toConversationResponse(conversation),
    );
  }

  private toConversationResponse(
    conversation: Awaited<
      ReturnType<ConversationsService["createConversation"]>
    >,
  ): ConversationResponseDto {
    return {
      id: conversation.id,
      tenantId: conversation.tenantId,
      customerId: conversation.customerId,
      channel: conversation.channel,
      status: conversation.status,
      currentFSMState: conversation.currentFSMState,
      collectedData:
        (conversation.collectedData as Record<string, unknown> | null) ?? null,
      providerConversationId: conversation.providerConversationId ?? null,
      twilioCallSid: conversation.twilioCallSid ?? null,
      twilioSmsSid: conversation.twilioSmsSid ?? null,
      startedAt: conversation.startedAt.toISOString(),
      endedAt: conversation.endedAt?.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }
}
