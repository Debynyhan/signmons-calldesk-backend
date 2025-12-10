import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigType } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";
import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";
import { AppModule } from "./app.module";
import { SanitizedExceptionFilter } from "./common/filters/sanitized-exception.filter";
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
  const wildcardOrigins = corsOrigins.filter(
    (origin) => origin !== "*" && origin.includes("*"),
  );
  const exactOrigins = corsOrigins.filter(
    (origin) => origin === "*" || !origin.includes("*"),
  );
  const wildcardRegexes = wildcardOrigins.map((pattern) => {
    const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
    const regexPattern = `^${escaped.replace(/\\\*/g, ".*")}$`;
    return new RegExp(regexPattern);
  });
  const isOriginAllowed = (origin?: string) => {
    if (!origin) {
      return true;
    }
    if (allowAllOrigins) {
      return true;
    }
    if (exactOrigins.includes(origin)) {
      return true;
    }
    return wildcardRegexes.some((regex) => regex.test(origin));
  };
  const resolveResponseOrigin = (origin?: string) => {
    if (allowAllOrigins) {
      return origin ?? "*";
    }
    if (!origin) {
      return corsOrigins[0] ?? "*";
    }
    return origin;
  };
  loggingService.log(
    `CORS origins: ${
      allowAllOrigins ? "*" : corsOrigins.join(", ") || "(none)"
    }`,
    "Bootstrap",
  );

  const corsOptions: CorsOptions = {
    origin: (requestOrigin, callback) => {
      if (isOriginAllowed(requestOrigin ?? undefined)) {
        callback(null, resolveResponseOrigin(requestOrigin ?? undefined));
      } else {
        callback(new Error("Origin not allowed by CORS"));
      }
    },
    methods: ["POST", "OPTIONS", "GET"],
    allowedHeaders: ["Content-Type", "x-admin-token"],
    maxAge: 3600,
  };

  app.enableCors(corsOptions);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin ?? undefined;
    const isAllowed = isOriginAllowed(origin);

    if (!isAllowed) {
      next();
      return;
    }

    const responseOrigin = resolveResponseOrigin(origin);

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
