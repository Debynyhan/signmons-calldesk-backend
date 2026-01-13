import { Module } from "@nestjs/common";
import { JOB_REPOSITORY } from "./jobs.constants";
import { JobsService } from "./jobs.service";
import { JobsToolRegistrar } from "./tools/jobs-tool.registrar";
import { CreateJobToolExecutor } from "./tools/create-job.executor";

@Module({
  providers: [
    JobsService,
    {
      provide: JOB_REPOSITORY,
      useExisting: JobsService,
    },
    CreateJobToolExecutor,
    JobsToolRegistrar,
  ],
  exports: [JOB_REPOSITORY, JobsService],
})
export class JobsModule {}
