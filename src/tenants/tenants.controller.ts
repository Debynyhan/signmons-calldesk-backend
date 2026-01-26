import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TENANTS_SERVICE } from "./tenants.constants";
import type { TenantsService } from "./interfaces/tenants-service.interface";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { UpdateTenantFeeSettingsDto } from "./dto/update-fee-settings.dto";
import { AdminApiGuard } from "../common/guards/admin-api.guard";

@Controller("tenants")
@UseGuards(AdminApiGuard)
export class TenantsController {
  constructor(
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
  ) {}

  @Post()
  async createTenant(@Body() dto: CreateTenantDto) {
    return this.tenantsService.createTenant(dto);
  }

  @Post(":tenantId/fee-policy/sync")
  async syncFeePolicy(@Param("tenantId") tenantId: string) {
    return this.tenantsService.syncTenantFeePolicy(tenantId);
  }

  @Post(":tenantId/settings/fees")
  async updateFeeSettings(
    @Param("tenantId") tenantId: string,
    @Body() dto: UpdateTenantFeeSettingsDto,
  ) {
    return this.tenantsService.updateTenantFeeSettings(tenantId, dto.fees);
  }
}
