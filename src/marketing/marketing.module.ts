import { Module } from "@nestjs/common";
import { MarketingController } from "./marketing.controller";
import { MarketingService } from "./marketing.service";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { LoggingModule } from "../logging/logging.module";
import { TenantsModule } from "../tenants/tenants.module";

@Module({
  imports: [PrismaModule, SanitizationModule, LoggingModule, TenantsModule],
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
