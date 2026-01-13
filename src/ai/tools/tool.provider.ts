import { Injectable } from "@nestjs/common";
import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";
import type { ToolDefinition } from "./tool.types";

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition) {
    if (!this.isFunctionTool(definition.tool)) {
      throw new Error("Tool definitions must use function tools.");
    }
    const name = definition.tool.function?.name;
    if (!name) {
      throw new Error("Tool definitions must include a function name.");
    }
    this.tools.set(name, definition);
  }

  getTools(): ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((entry) => entry.tool);
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  private isFunctionTool(
    tool: ChatCompletionTool,
  ): tool is ChatCompletionTool & { function: { name: string } } {
    return tool.type === "function" && "function" in tool;
  }
}
