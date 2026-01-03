import { Module } from "@nestjs/common";
import { JOB_REPOSITORY } from "./jobs.constants";
import { JobsService } from "./jobs.service";
import { JobsToolRegistrar } from "./tools/jobs-tool.registrar";
import { JobsController } from "./jobs.controller";
import { FirebaseAuthGuard } from "../auth/firebase-auth.guard";
import { TenantGuard } from "../common/guards/tenant.guard";

@Module({
  controllers: [JobsController],
  providers: [
    JobsService,
    FirebaseAuthGuard,
    TenantGuard,
    {
      provide: JOB_REPOSITORY,
      useExisting: JobsService,
    },
    JobsToolRegistrar,
  ],
  exports: [JOB_REPOSITORY, JobsService],
})
export class JobsModule {}
