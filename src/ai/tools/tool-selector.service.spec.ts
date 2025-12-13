import { jest } from "@jest/globals";
import { ConfigType } from "@nestjs/config";
import appConfig from "../../config/app.config";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { ToolSelectorService } from "./tool-selector.service";
import type { ToolRegistryService } from "./tool.provider";

const mockTool = (name: string): ChatCompletionTool => ({
  type: "function",
  function: {
    name,
    description: `${name} description`,
    parameters: {
      type: "object",
      properties: {},
    },
  },
});

describe("ToolSelectorService", () => {
  const availableTools = [mockTool("create_job"), mockTool("mark_emergency")];
  let registry: jest.Mocked<ToolRegistryService>;
  let config: ConfigType<typeof appConfig>;

  beforeEach(() => {
    registry = {
      register: jest.fn(),
      getTools: jest.fn().mockReturnValue(availableTools),
    } as unknown as jest.Mocked<ToolRegistryService>;

    config = {
      environment: "test",
      openAiApiKey: "key",
      enablePreviewModel: false,
      enabledTools: ["create_job"],
      port: 0,
      databaseUrl: "postgres://example",
      adminApiToken: "token",
      corsOrigins: [],
    };
  });

  it("returns only the tools allowed for a tenant", () => {
    const service = new ToolSelectorService(registry, config);

    const tools = service.getEnabledToolsForTenant(["mark_emergency"]);

    expect(tools).toHaveLength(1);
    expect(tools[0].function?.name).toBe("mark_emergency");
  });

  it("falls back to globally enabled tools when tenant list is empty", () => {
    const service = new ToolSelectorService(registry, config);

    const tools = service.getEnabledToolsForTenant([]);

    expect(tools).toHaveLength(1);
    expect(tools[0].function?.name).toBe("create_job");
  });

  it("omits tools that are not registered", () => {
    registry.getTools.mockReturnValue([availableTools[0]]);
    const service = new ToolSelectorService(registry, config);

    const tools = service.getEnabledToolsForTenant(["mark_emergency"]);

    expect(tools).toHaveLength(0);
  });
});
