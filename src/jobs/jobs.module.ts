import { Module } from "@nestjs/common";
import { JOB_REPOSITORY } from "./jobs.constants";
import { InMemoryJobRepository } from "./jobs.service";
import { JobsToolRegistrar } from "./tools/jobs-tool.registrar";

@Module({
  providers: [
    {
      provide: JOB_REPOSITORY,
      useClass: InMemoryJobRepository,
    },
    JobsToolRegistrar,
  ],
  exports: [JOB_REPOSITORY],
})
export class JobsModule {}
