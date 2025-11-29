import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";

export const CREATE_JOB_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_job",
    description: "Create a new job after AI triage for a contractor.",
    parameters: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "Full name of the customer.",
        },
        phone: {
          type: "string",
          description: "Customer phone number in E.164 or local format.",
        },
        address: {
          type: "string",
          description: "Service address, if provided.",
        },
        issueCategory: {
          type: "string",
          description: "High-level issue category.",
          enum: [
            "HEATING",
            "COOLING",
            "PLUMBING",
            "ELECTRICAL",
            "DRAINS",
            "GENERAL",
          ],
        },
        urgency: {
          type: "string",
          description: "Urgency classification based on safety/discomfort.",
          enum: ["EMERGENCY", "HIGH", "STANDARD"],
        },
        description: {
          type: "string",
          description: "Short description in the customer's own words.",
        },
        preferredTime: {
          type: "string",
          description: "Preferred appointment window if mentioned.",
        },
      },
      required: ["customerName", "phone", "issueCategory", "urgency"],
      additionalProperties: false,
    },
  },
};
