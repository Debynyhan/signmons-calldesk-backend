import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";
import { AI_ROUTE_INTENTS } from "../routing/ai-route-state";

export const ROUTE_CONVERSATION_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "route_conversation",
    description: "Route the customer to the correct conversation lane.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: [...AI_ROUTE_INTENTS],
          description: "The conversation lane the customer should be routed to.",
        },
      },
      required: ["intent"],
      additionalProperties: false,
    },
  },
};
