import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { VoiceInboundUseCase } from "./voice-inbound.use-case";
import { TwilioSignatureGuard } from "./twilio-signature.guard";
import { TwilioVoiceWebhookDto } from "./dto/twilio-voice-webhook.dto";

const twilioBodyPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: false,
});

@UseGuards(TwilioSignatureGuard)
@Controller("api/voice")
export class VoiceController {
  constructor(private readonly voiceInboundUseCase: VoiceInboundUseCase) {}

  @Post("inbound")
  async handleInbound(
    @Req() req: Request,
    @Res() res: Response,
    @Body(twilioBodyPipe) _body: TwilioVoiceWebhookDto,
  ) {
    return this.voiceInboundUseCase.handleInbound(req, res);
  }

  @Post("demo-inbound")
  async handleDemoInbound(
    @Req() req: Request,
    @Res() res: Response,
    @Body(twilioBodyPipe) _body: TwilioVoiceWebhookDto,
  ) {
    return this.voiceInboundUseCase.handleDemoInbound(req, res);
  }

  @Post("turn")
  async handleTurn(
    @Req() req: Request,
    @Res() res: Response,
    @Body(twilioBodyPipe) _body: TwilioVoiceWebhookDto,
  ) {
    return this.voiceInboundUseCase.handleTurn(req, res);
  }

  @Post("fallback")
  async handleFallback(
    @Req() req: Request,
    @Res() res: Response,
    @Body(twilioBodyPipe) _body: TwilioVoiceWebhookDto,
  ) {
    return this.voiceInboundUseCase.handleFallback(req, res);
  }

  @Post("status")
  handleStatus(@Req() _req: Request, @Res() res: Response) {
    return res.status(200).send();
  }
}
