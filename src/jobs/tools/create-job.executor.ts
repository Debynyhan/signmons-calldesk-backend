import { Inject, Injectable } from "@nestjs/common";
import { JOB_REPOSITORY } from "../jobs.constants";
import type {
  IJobRepository,
  JobRecord,
} from "../interfaces/job-repository.interface";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../../ai/tools/tool.types";

@Injectable()
export class CreateJobToolExecutor {
  constructor(
    @Inject(JOB_REPOSITORY) private readonly jobsRepository: IJobRepository,
  ) {}

  async execute(
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const job: JobRecord = await this.jobsRepository.createJobFromToolCall({
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      rawArgs: context.rawArgs,
    });

    return {
      response: {
        status: "job_created",
        job,
        message: "Job created successfully.",
      },
      log: {
        jobId: job.id,
        transcript: context.rawArgs ?? "",
        aiResponse: JSON.stringify(job),
        metadata: { toolName: "create_job" },
      },
      clearSession: true,
    };
  }
}
