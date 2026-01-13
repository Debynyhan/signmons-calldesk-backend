import { Inject, Injectable } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import appConfig from "../../config/app.config";
import { ToolRegistryService } from "./tool.provider";
import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";
import type { ToolDefinition } from "./tool.types";

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
        (tool) =>
          tool.type === "function" &&
          enabled.has(tool.function?.name ?? ""),
      );
  }

  getToolDefinitionForTenant(
    tenantId: string,
    name: string,
  ): ToolDefinition | null {
    void tenantId;
    const enabled = new Set(this.config.enabledTools);
    if (!enabled.has(name)) {
      return null;
    }
    return this.toolRegistry.getToolDefinition(name) ?? null;
  }
}
