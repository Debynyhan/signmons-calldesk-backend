import { Injectable, OnModuleInit } from "@nestjs/common";
import { ToolExecutorRegistryService } from "./tool-executor.registry";
import { RouteConversationToolExecutor } from "./route-conversation.executor";
import { AiCreateJobToolExecutor } from "./create-job.executor";

@Injectable()
export class AiToolExecutorRegistrar implements OnModuleInit {
  constructor(
    private readonly executorRegistry: ToolExecutorRegistryService,
    private readonly routeConversationExecutor: RouteConversationToolExecutor,
    private readonly createJobExecutor: AiCreateJobToolExecutor,
  ) {}

  onModuleInit() {
    this.executorRegistry.register(this.routeConversationExecutor);
    this.executorRegistry.register(this.createJobExecutor);
  }
}
