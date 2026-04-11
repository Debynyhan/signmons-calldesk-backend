import { Global, Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggingService } from "./logging.service";
import { CallLogService } from "./call-log.service";
import { CallLogCleanupService } from "./call-log.cleanup";
import { AlertingService } from "./alerting.service";
import { PiiObfuscatorService } from "./pii-obfuscator.service";

@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    LoggingService,
    CallLogService,
    CallLogCleanupService,
    AlertingService,
    PiiObfuscatorService,
  ],
  exports: [LoggingService, CallLogService, AlertingService, PiiObfuscatorService],
})
export class LoggingModule {}
