import { Module } from "@nestjs/common";
import { TENANTS_SERVICE } from "./tenants.constants";
import { PrismaTenantsService } from "./tenants.service";
import { TenantsController } from "./tenants.controller";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { TenantAnalyticsService } from "../analytics/tenant-analytics.service";

@Module({
  imports: [SanitizationModule],
  controllers: [TenantsController],
  providers: [
    PrismaTenantsService,
    AdminApiGuard,
    TenantAnalyticsService,
    {
      provide: TENANTS_SERVICE,
      useExisting: PrismaTenantsService,
    },
  ],
  exports: [TENANTS_SERVICE],
})
export class TenantsModule {}
