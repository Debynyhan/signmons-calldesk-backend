import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { IntakeCheckoutDto } from "./dto/intake-checkout.dto";
import { PaymentsService } from "./payments.service";
import { PaymentsPageRendererService } from "./payments-page-renderer.service";

@Controller("api/payments")
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly pageRenderer: PaymentsPageRendererService,
  ) {}

  @Get("intake/:token")
  @Header("Content-Type", "text/html; charset=utf-8")
  async renderIntakePage(@Param("token") token: string): Promise<string> {
    const data = await this.paymentsService.getIntakePageData(token);
    return this.pageRenderer.renderIntakePage(token, data);
  }

  @Post("intake/:token/checkout")
  async createCheckoutSession(
    @Param("token") token: string,
    @Body() input: IntakeCheckoutDto,
    @Res() res: Response,
  ) {
    const result = await this.paymentsService.createCheckoutSessionFromIntake({
      token,
      input,
    });
    return res.redirect(303, result.checkoutUrl);
  }

  @Get("intake/:token/success")
  @Header("Content-Type", "text/html; charset=utf-8")
  renderSuccessPage(): string {
    return this.pageRenderer.renderSuccessPage();
  }

  @Get("intake/:token/cancel")
  @Header("Content-Type", "text/html; charset=utf-8")
  renderCancelPage(): string {
    return this.pageRenderer.renderCancelPage();
  }

  @Post("stripe/webhook")
  @HttpCode(200)
  async handleStripeWebhook(@Req() req: Request) {
    return this.paymentsService.handleStripeWebhook(req);
  }
}
