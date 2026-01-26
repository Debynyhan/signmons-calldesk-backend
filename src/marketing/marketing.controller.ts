import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { MarketingService } from "./marketing.service";
import { TryDemoDto } from "./dto/try-demo.dto";

@Controller("api/marketing")
export class MarketingController {
  constructor(private readonly marketingService: MarketingService) {}

  @Post("try-demo")
  @HttpCode(202)
  async submitTryDemo(@Body() payload: TryDemoDto) {
    return this.marketingService.submitTryDemo(payload);
  }
}
