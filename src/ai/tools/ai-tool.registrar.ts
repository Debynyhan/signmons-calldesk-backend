import { Injectable, OnModuleInit } from "@nestjs/common";
import { ToolRegistryService } from "./tool.provider";
import { ROUTE_CONVERSATION_TOOL } from "./route-conversation.tool";

@Injectable()
export class AiToolRegistrar implements OnModuleInit {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  onModuleInit() {
    this.toolRegistry.register(ROUTE_CONVERSATION_TOOL);
  }
}
