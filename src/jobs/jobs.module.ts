import { Module } from "@nestjs/common";
import { JOBS_SERVICE } from "./jobs.constants";
import { InMemoryJobsService } from "./jobs.service";
import { JobsToolRegistrar } from "./tools/jobs-tool.registrar";

@Module({
  providers: [
    {
      provide: JOBS_SERVICE,
      useClass: InMemoryJobsService,
    },
    JobsToolRegistrar,
  ],
  exports: [JOBS_SERVICE],
})
export class JobsModule {}
