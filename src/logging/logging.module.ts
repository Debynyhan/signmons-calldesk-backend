import { Global, Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggingService } from "./logging.service";
import { CallLogService } from "./call-log.service";
import { CallLogCleanupService } from "./call-log.cleanup";
import { AlertingService } from "./alerting.service";
import { PiiObfuscatorService } from "./pii-obfuscator.service";
import { CALL_LOG_SERVICE } from "./call-log.service.interface";

@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    LoggingService,
    CallLogService,
    { provide: CALL_LOG_SERVICE, useExisting: CallLogService },
    CallLogCleanupService,
    AlertingService,
    PiiObfuscatorService,
  ],
  exports: [LoggingService, CallLogService, CALL_LOG_SERVICE, AlertingService, PiiObfuscatorService],
})
export class LoggingModule {}
