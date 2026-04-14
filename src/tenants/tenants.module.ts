import { Module } from "@nestjs/common";
import { TENANTS_SERVICE } from "./tenants.constants";
import { PrismaTenantsService } from "./tenants.service";
import { TenantPromptBuilderService } from "./tenant-prompt-builder.service";
import { TenantFeePolicySynchronizerService } from "./tenant-fee-policy-synchronizer.service";
import { TenantsController } from "./tenants.controller";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { AdminAuditInterceptor } from "../common/interceptors/admin-audit.interceptor";
import { LoggingModule } from "../logging/logging.module";

@Module({
  imports: [SanitizationModule, LoggingModule],
  controllers: [TenantsController],
  providers: [
    TenantPromptBuilderService,
    TenantFeePolicySynchronizerService,
    PrismaTenantsService,
    AdminApiGuard,
    AdminAuditInterceptor,
    {
      provide: TENANTS_SERVICE,
      useExisting: PrismaTenantsService,
    },
  ],
  exports: [TENANTS_SERVICE],
})
export class TenantsModule {}
