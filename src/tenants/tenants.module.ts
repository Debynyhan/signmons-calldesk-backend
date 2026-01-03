import { Module } from "@nestjs/common";
import { TENANTS_SERVICE } from "./tenants.constants";
import { PrismaTenantsService } from "./tenants.service";
import { TenantsController } from "./tenants.controller";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { FirebaseAuthGuard } from "../auth/firebase-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";

@Module({
  imports: [SanitizationModule],
  controllers: [TenantsController],
  providers: [
    PrismaTenantsService,
    AdminApiGuard,
    FirebaseAuthGuard,
    RolesGuard,
    {
      provide: TENANTS_SERVICE,
      useExisting: PrismaTenantsService,
    },
  ],
  exports: [TENANTS_SERVICE],
})
export class TenantsModule {}
