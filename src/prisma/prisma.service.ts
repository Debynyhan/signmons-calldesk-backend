import {
  Inject,
  Injectable,
  INestApplication,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import appConfig from "../config/app.config";
import { getRequestContext } from "../common/context/request-context";

type MiddlewareParams = {
  model?: string;
  action: string;
  args?: Record<string, unknown>;
};

type PrismaMiddleware = (
  params: MiddlewareParams,
  next: (params: MiddlewareParams) => Promise<unknown>,
) => Promise<unknown>;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is not configured.");
    }

    const pool = new Pool({ connectionString: config.databaseUrl });

    super({
      adapter: new PrismaPg(pool),
      log: ["warn", "error"],
    });

    const client = this as unknown as {
      $use: (middleware: PrismaMiddleware) => void;
    };

    client.$use(this.enforceTenantIsolation.bind(this));

    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  enableShutdownHooks(app: INestApplication) {
    process.on("beforeExit", () => {
      void app.close();
    });
  }

  private enforceTenantIsolation: PrismaMiddleware = async (params, next) => {
    const ctx = getRequestContext();
    const tenantId = ctx?.tenantId;
    const impersonatedTenantId = ctx?.impersonatedTenantId;
    const role = ctx?.role ?? null;
    const effectiveTenantId = impersonatedTenantId ?? tenantId;

    if (ctx?.role === "admin" && !ctx?.impersonatedTenantId) {
      await this.setRlsContext(null, role);
      return next(params);
    }

    if (effectiveTenantId) {
      await this.setRlsContext(effectiveTenantId, role);
    } else if (role) {
      await this.setRlsContext(null, role);
    }

    if (tenantId && this.isTenantScoped(params.model, params.args)) {
      this.injectTenantFilter(params, tenantId);
    }

    return next(params);
  };

  private isTenantScoped(model?: string, args?: unknown): boolean {
    if (!model || !args) return false;

    const candidate = args as Record<string, unknown>;
    const data = candidate.data as Record<string, unknown> | undefined;
    const where = candidate.where as Record<string, unknown> | undefined;

    return Boolean(
      (data && Object.prototype.hasOwnProperty.call(data, "tenantId")) ||
      (where && Object.prototype.hasOwnProperty.call(where, "tenantId")),
    );
  }

  private injectTenantFilter(params: MiddlewareParams, tenantId: string) {
    const action = params.action;
    const args: Record<string, unknown> = params.args ?? {};
    params.args = args;

    if (action === "create") {
      const data = (args.data ?? {}) as Record<string, unknown>;
      if (data.tenantId === undefined) {
        data.tenantId = tenantId;
      }
      args.data = data;
      return;
    }

    const needsWhere = [
      "findUnique",
      "findFirst",
      "findMany",
      "update",
      "updateMany",
      "delete",
      "deleteMany",
      "upsert",
    ].includes(action);

    if (!needsWhere) return;

    const where = (args.where ?? {}) as Record<string, unknown>;
    if (where.tenantId === undefined) {
      where.tenantId = tenantId;
    }
    args.where = where;
  }

  private async setRlsContext(tenantId: string | null, role: string | null) {
    await this.$executeRaw`
      SELECT
        set_config('app.current_tenant', ${tenantId ?? ""}, true),
        set_config('app.current_role', ${role ?? ""}, true);
    `;
  }
}
