import {
  Inject,
  Injectable,
  INestApplication,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
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

    let schema = "public";
    try {
      const url = new URL(config.databaseUrl);
      schema = url.searchParams.get("schema") ?? schema;
    } catch {
      schema = "public";
    }
    const safeSchema = schema.replace(/[^a-zA-Z0-9_]/g, "") || "public";

    const pool = new Pool({
      connectionString: config.databaseUrl,
      options: `-c search_path=${safeSchema}`,
    });
    pool.on("connect", (client) => {
      client.query(`SET search_path TO ${safeSchema}`);
    });

    super({
      adapter: new PrismaPg(pool),
      log: ["warn", "error"],
    });

    const serviceRef = this;
    const extension = Prisma.defineExtension({
      query: {
        $allModels: {
          $allOperations: async ({ model, operation, args, query }) => {
            const normalizedArgs =
              args && typeof args === "object"
                ? (args as Record<string, unknown>)
                : undefined;
            const params: MiddlewareParams = {
              model,
              action: operation,
              args: normalizedArgs,
            };

            return serviceRef.enforceTenantIsolation(params, (updated) =>
              query(updated.args ?? args),
            );
          },
        },
      },
    });

    const extended = this.$extends(extension);
    Object.assign(this, extended);

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
