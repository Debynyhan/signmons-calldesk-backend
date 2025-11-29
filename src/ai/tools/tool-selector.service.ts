import { Inject, Injectable } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import appConfig from "../../config/app.config";
import { ToolRegistryService } from "./tool.provider";
import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";

@Injectable()
export class ToolSelectorService {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>
  ) {}

  getEnabledToolsForTenant(_tenantId: string): ChatCompletionTool[] {
    const enabled = new Set(this.config.enabledTools);
    return this.toolRegistry
      .getTools()
      .filter((tool) => enabled.has(tool.function?.name ?? ""));
  }
}
