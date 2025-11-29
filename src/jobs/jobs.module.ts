import { Module } from "@nestjs/common";
import { JOBS_SERVICE } from "./jobs.constants";
import { InMemoryJobsService } from "./jobs.service";

@Module({
  providers: [
    {
      provide: JOBS_SERVICE,
      useClass: InMemoryJobsService,
    },
  ],
  exports: [JOBS_SERVICE],
})
export class JobsModule {}
