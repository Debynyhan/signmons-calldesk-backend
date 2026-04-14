import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { AdminAuditInterceptor } from "../common/interceptors/admin-audit.interceptor";
import { ConfirmFieldDto } from "./dto/confirm-field.dto";
import { TwilioSmsWebhookDto } from "./dto/twilio-sms-webhook.dto";
import { SmsInboundUseCase } from "./sms-inbound.use-case";

const twilioBodyPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: false,
});

@Controller("api/sms")
export class SmsController {
  constructor(private readonly smsInboundUseCase: SmsInboundUseCase) {}

  @Post("confirm-field")
  @UseGuards(AdminApiGuard)
  @UseInterceptors(AdminAuditInterceptor)
  @HttpCode(200)
  async confirmField(@Body() dto: ConfirmFieldDto) {
    return this.smsInboundUseCase.confirmField(dto);
  }

  @Post("inbound")
  async handleInbound(
    @Req() req: Request,
    @Res() res: Response,
    @Body(twilioBodyPipe) body: TwilioSmsWebhookDto,
  ) {
    void body;
    return this.smsInboundUseCase.handleInbound(req, res);
  }
}
