import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../../config/app.config";
import { ToolRegistryService } from "./tool.provider";
import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";

@Injectable()
export class ToolSelectorService {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  getEnabledToolsForTenant(tenantId: string): ChatCompletionTool[] {
    // tenantId is reserved for future tenant-specific tool policies
    void tenantId;
    const enabled = new Set(this.config.enabledTools);
    return this.toolRegistry
      .getTools()
      .filter(
        (tool) => this.isFunctionTool(tool) && enabled.has(tool.function?.name ?? ""),
      );
  }

  private isFunctionTool(
    tool: ChatCompletionTool,
  ): tool is ChatCompletionTool & { function: { name: string } } {
    return tool.type === "function" && "function" in tool;
  }
}
