import {
  BadRequestException,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  UseGuards,
  Body,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { ConversationsService } from "../conversations/conversations.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { getRequestContext } from "../common/context/request-context";
import { ConfirmFieldDto } from "./dto/confirm-field.dto";

@Controller("api/sms")
@UseGuards(AdminApiGuard)
export class SmsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly sanitizationService: SanitizationService,
  ) {}

  @Post("confirm-field")
  @HttpCode(200)
  async confirmField(@Body() dto: ConfirmFieldDto) {
    const context = getRequestContext();
    const tenantId = context?.tenantId ?? dto.tenantId;
    if (!tenantId) {
      throw new BadRequestException("Missing tenantId.");
    }

    const conversation = await this.conversationsService.getConversationById({
      tenantId,
      conversationId: dto.conversationId,
    });
    if (!conversation) {
      throw new NotFoundException("Conversation not found.");
    }

    const sanitizedValue = this.sanitizationService.normalizeWhitespace(
      this.sanitizationService.sanitizeText(dto.value),
    );
    if (!sanitizedValue) {
      throw new BadRequestException("Invalid value.");
    }

    const sourceEventId =
      dto.sourceEventId?.trim() ?? `sms-${randomUUID()}`;

    if (dto.field === "name") {
      await this.conversationsService.promoteNameFromSms({
        tenantId,
        conversationId: dto.conversationId,
        value: sanitizedValue,
        sourceEventId,
      });
    } else {
      await this.conversationsService.promoteAddressFromSms({
        tenantId,
        conversationId: dto.conversationId,
        value: sanitizedValue,
        sourceEventId,
      });
    }

    return {
      status: "confirmed",
      field: dto.field,
      conversationId: dto.conversationId,
    };
  }
}
