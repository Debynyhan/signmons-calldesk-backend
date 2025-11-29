import { Injectable } from "@nestjs/common";
import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";

@Injectable()
export class ToolRegistryService {
  private readonly tools: ChatCompletionTool[] = [];

  register(tool: ChatCompletionTool) {
    this.tools.push(tool);
  }

  getTools(): ChatCompletionTool[] {
    return this.tools;
  }
}
