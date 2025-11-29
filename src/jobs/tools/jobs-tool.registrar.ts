import { Injectable, OnModuleInit } from "@nestjs/common";
import { ToolRegistryService } from "../../ai/tools/tool.provider";
import { CREATE_JOB_TOOL } from "./create-job.tool";

@Injectable()
export class JobsToolRegistrar implements OnModuleInit {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  onModuleInit() {
    this.toolRegistry.register(CREATE_JOB_TOOL);
  }
}
