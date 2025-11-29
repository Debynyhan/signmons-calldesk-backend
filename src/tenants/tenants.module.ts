import { Module } from "@nestjs/common";
import { TENANTS_SERVICE } from "./tenants.constants";
import { StaticTenantsService } from "./tenants.service";

@Module({
  providers: [
    {
      provide: TENANTS_SERVICE,
      useClass: StaticTenantsService,
    },
  ],
  exports: [TENANTS_SERVICE],
})
export class TenantsModule {}
