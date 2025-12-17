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

  getEnabledToolsForTenant(
    tenantId: string,
    tenantAllowedTools?: string[],
  ): ChatCompletionTool[] {
    void tenantId;
    const globalEnabled = new Set(this.config.enabledTools);

    let activeTools: Set<string>;
    if (tenantAllowedTools?.length) {
      const normalized = tenantAllowedTools
        .map((tool) => tool.trim())
        .filter((tool) => tool.length > 0);
      const filtered = normalized.filter((tool) => globalEnabled.has(tool));
      activeTools = filtered.length
        ? new Set(filtered)
        : new Set(globalEnabled);
    } else {
      activeTools = globalEnabled;
    }

    return this.toolRegistry
      .getTools()
      .filter((tool) => activeTools.has(tool.function?.name ?? ""));
  }
}
