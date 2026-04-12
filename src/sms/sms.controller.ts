import {
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  Body,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { ConfirmFieldDto } from "./dto/confirm-field.dto";
import { SmsInboundUseCase } from "./sms-inbound.use-case";

@Controller("api/sms")
export class SmsController {
  constructor(private readonly smsInboundUseCase: SmsInboundUseCase) {}

  @Post("confirm-field")
  @UseGuards(AdminApiGuard)
  @HttpCode(200)
  async confirmField(@Body() dto: ConfirmFieldDto) {
    return this.smsInboundUseCase.confirmField(dto);
  }

  @Post("inbound")
  async handleInbound(@Req() req: Request, @Res() res: Response) {
    return this.smsInboundUseCase.handleInbound(req, res);
  }
}
