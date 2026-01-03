import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { TENANTS_SERVICE } from "./tenants.constants";
import type { TenantsService } from "./interfaces/tenants-service.interface";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { FirebaseAuthGuard } from "../auth/firebase-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";

@Controller("tenants")
@UseGuards(FirebaseAuthGuard, RolesGuard, AdminApiGuard)
export class TenantsController {
  constructor(
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
  ) {}

  @Post()
  @Roles("admin")
  async createTenant(@Body() dto: CreateTenantDto) {
    return this.tenantsService.createTenant(dto);
  }
}
