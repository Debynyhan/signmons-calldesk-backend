import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigType } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { SanitizedExceptionFilter } from "./common/filters/sanitized-exception.filter";
import { requestContextMiddleware } from "./common/context/request-context";
import { LoggingService } from "./logging/logging.service";
import appConfig from "./config/app.config";
import { PrismaService } from "./prisma/prisma.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  const port = config?.port ?? Number(process.env.PORT ?? 3000);
  const loggingService = app.get(LoggingService);
  const corsOrigins = config?.corsOrigins ?? [];
  const allowAllOrigins = corsOrigins.includes("*");
  loggingService.log(
    `CORS origins: ${
      allowAllOrigins ? "*" : corsOrigins.join(", ") || "(none)"
    }`,
    "Bootstrap",
  );

  app.enableCors({
    origin: allowAllOrigins ? true : corsOrigins,
    methods: ["POST", "OPTIONS", "GET"],
    allowedHeaders: ["Content-Type", "x-admin-token"],
    maxAge: 3600,
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin ?? undefined;
    const isAllowed =
      allowAllOrigins || (origin !== undefined && corsOrigins.includes(origin));

    if (!isAllowed) {
      next();
      return;
    }

    const responseOrigin = origin ?? corsOrigins[0] ?? "*";

    res.header("Access-Control-Allow-Origin", responseOrigin);
    res.header("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.use(requestContextMiddleware);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      validateCustomDecorators: true,
      stopAtFirstError: true,
    }),
  );
  app.useGlobalFilters(new SanitizedExceptionFilter(loggingService));
  const prismaService = app.get(PrismaService);
  prismaService.enableShutdownHooks(app);
  await app.listen(port);
  console.log(`[bootstrap] Signmons CallDesk API listening on port ${port}`);
}

void bootstrap().catch((error) => {
  console.error("[bootstrap] Failed to initialize application.", error);
  process.exitCode = 1;
});
