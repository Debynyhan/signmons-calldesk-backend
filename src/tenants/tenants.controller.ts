import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TENANTS_SERVICE } from "./tenants.constants";
import type { TenantsService } from "./interfaces/tenants-service.interface";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { TenantAnalyticsService } from "../analytics/tenant-analytics.service";

@Controller("tenants")
@UseGuards(AdminApiGuard)
export class TenantsController {
  constructor(
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
    private readonly tenantAnalytics: TenantAnalyticsService,
  ) {}

  @Post()
  async createTenant(@Body() dto: CreateTenantDto) {
    return this.tenantsService.createTenant(dto);
  }

  @Get(":tenantId/analytics")
  async getTenantAnalytics(@Param("tenantId") tenantId: string) {
    const context = await this.tenantsService.getTenantContext(tenantId);
    return this.tenantAnalytics.getAnalyticsSnapshot(context.tenantId);
  }
}
