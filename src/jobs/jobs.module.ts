import { Module } from "@nestjs/common";
import { JOB_REPOSITORY } from "./jobs.constants";
import { JobsService } from "./jobs.service";
import { IssueNormalizerService } from "./issue-normalizer.service";
import { CreateJobPayloadValidatorService } from "./create-job-payload-validator.service";
import { JobsToolRegistrar } from "./tools/jobs-tool.registrar";

@Module({
  providers: [
    IssueNormalizerService,
    CreateJobPayloadValidatorService,
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
