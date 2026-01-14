import {
  Inject,
  Injectable,
  INestApplication,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import appConfig from "../config/app.config";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
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
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  enableShutdownHooks(app: INestApplication) {
    process.on("beforeExit", () => {
      void app.close();
    });
  }
}
