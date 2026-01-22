import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { TenantThrottleGuard } from "./common/guards/tenant-throttle.guard";
import { AppService } from "./app.service";
import { AppController } from "./app.controller";
import { AiModule } from "./ai/ai.module";
import appConfig from "./config/app.config";
import { envValidationSchema } from "./config/env.validation";
import { LoggingModule } from "./logging/logging.module";
import { SanitizationModule } from "./sanitization/sanitization.module";
import { ToolRegistryModule } from "./ai/tools/tool-registry.module";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthController } from "./health/health.controller";
import { VoiceModule } from "./voice/voice.module";
import { SmsModule } from "./sms/sms.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig],
      validationSchema: envValidationSchema,
    }),
    LoggingModule,
    SanitizationModule,
    ToolRegistryModule,
    PrismaModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60,
        limit: 10,
      },
    ]),
    AiModule,
    VoiceModule,
    SmsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantThrottleGuard,
    },
  ],
})
export class AppModule {}
