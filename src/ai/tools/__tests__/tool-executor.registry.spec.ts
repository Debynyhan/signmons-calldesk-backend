import { jest } from "@jest/globals";
import { ToolExecutorRegistryService } from "../tool-executor.registry";
import type { RegisteredToolExecutor } from "../tool.types";

describe("ToolExecutorRegistryService", () => {
  const makeExecutor = (toolName: string): RegisteredToolExecutor => ({
    toolName,
    execute: jest.fn(async () => ({ status: "reply", reply: "ok" })),
  });

  it("registers and retrieves executors by tool name", () => {
    const registry = new ToolExecutorRegistryService();
    const executor = makeExecutor("create_job");

    registry.register(executor);

    expect(registry.get("create_job")).toBe(executor);
  });

  it("returns null for unregistered tools", () => {
    const registry = new ToolExecutorRegistryService();

    expect(registry.get("missing_tool")).toBeNull();
  });

  it("rejects duplicate registrations for the same tool name", () => {
    const registry = new ToolExecutorRegistryService();
    registry.register(makeExecutor("route_conversation"));

    expect(() =>
      registry.register(makeExecutor("route_conversation")),
    ).toThrow("Tool executor already registered: route_conversation");
  });
});
