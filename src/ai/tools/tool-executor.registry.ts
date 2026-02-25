import { Injectable } from "@nestjs/common";
import type { RegisteredToolExecutor } from "./tool.types";

@Injectable()
export class ToolExecutorRegistryService {
  private readonly executors = new Map<string, RegisteredToolExecutor>();

  register(executor: RegisteredToolExecutor) {
    if (this.executors.has(executor.toolName)) {
      throw new Error(`Tool executor already registered: ${executor.toolName}`);
    }
    this.executors.set(executor.toolName, executor);
  }

  get(toolName: string): RegisteredToolExecutor | null {
    return this.executors.get(toolName) ?? null;
  }
}
