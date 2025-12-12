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
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  getEnabledToolsForTenant(allowedTools?: string[]): ChatCompletionTool[] {
    const fallback = this.config.enabledTools ?? [];
    const effectiveTools =
      allowedTools && allowedTools.length > 0 ? allowedTools : fallback;
    const enabled = new Set(effectiveTools);
    return this.toolRegistry
      .getTools()
      .filter((tool) => enabled.has(tool.function?.name ?? ""));
  }
}
