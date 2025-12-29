import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ConversationsService } from "./conversations.service";
import { CreateConversationDto } from "./dto/create-conversation.dto";
import { ConversationResponseDto } from "./dto/conversation-response.dto";
import { ListConversationsQueryDto } from "./dto/list-conversations-query.dto";

@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  async createConversation(
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationResponseDto> {
    const conversation =
      await this.conversationsService.createConversation(dto);
    return this.toConversationResponse(conversation);
  }

  @Get()
  async listConversations(
    @Query() query: ListConversationsQueryDto,
  ): Promise<ConversationResponseDto[]> {
    const conversations = await this.conversationsService.listConversations(
      query.tenantId,
    );
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
