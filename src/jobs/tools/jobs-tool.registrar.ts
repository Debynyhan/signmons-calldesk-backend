import { Injectable, OnModuleInit } from "@nestjs/common";
import { ToolRegistryService } from "../../ai/tools/tool.provider";
import { CREATE_JOB_TOOL } from "./create-job.tool";
import { CreateJobToolExecutor } from "./create-job.executor";

@Injectable()
export class JobsToolRegistrar implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly createJobToolExecutor: CreateJobToolExecutor,
  ) {}

  onModuleInit() {
    this.toolRegistry.register({
      tool: CREATE_JOB_TOOL,
      execute: this.createJobToolExecutor.execute.bind(
        this.createJobToolExecutor,
      ),
    });
  }
}
