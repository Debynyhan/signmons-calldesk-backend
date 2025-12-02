import { Module } from "@nestjs/common";
import { JOB_REPOSITORY } from "./jobs.constants";
import { JobsService } from "./jobs.service";
import { JobsToolRegistrar } from "./tools/jobs-tool.registrar";

@Module({
  providers: [
    JobsService,
    {
      provide: JOB_REPOSITORY,
      useExisting: JobsService,
    },
    JobsToolRegistrar,
  ],
  exports: [JOB_REPOSITORY, JobsService],
})
export class JobsModule {}
