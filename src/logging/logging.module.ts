import { Global, Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggingService } from "./logging.service";
import { CallLogService } from "./call-log.service";
import { CallLogCleanupService } from "./call-log.cleanup";

@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [LoggingService, CallLogService, CallLogCleanupService],
  exports: [LoggingService, CallLogService],
})
export class LoggingModule {}
