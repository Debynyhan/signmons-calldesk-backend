import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SanitizedExceptionFilter } from "./common/filters/sanitized-exception.filter";
import { LoggingService } from "./logging/logging.service";

async function bootstrap() {
  const port = process.env.PORT ?? 3000;
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const loggingService = app.get(LoggingService);
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
  await app.listen(port);
  console.log(`[bootstrap] Signmons CallDesk API listening on port ${port}`);
}

void bootstrap().catch((error) => {
  console.error("[bootstrap] Failed to initialize application.", error);
  process.exitCode = 1;
});
