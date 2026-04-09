import { Injectable } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service";

export type VoiceUrgencyBinaryIntent = "YES" | "NO" | null;

export type VoiceUrgencyExpectedFieldOutcome =
  | { kind: "not_applicable" }
  | { kind: "answered"; preface: string }
  | { kind: "reprompt" };

@Injectable()
export class VoiceUrgencySlotService {
  constructor(private readonly conversationsService: ConversationsService) {}

  async handleExpectedField(params: {
    expectedField: "comfort_risk" | "urgency_confirm" | null;
    binaryIntent: VoiceUrgencyBinaryIntent;
    tenantId: string;
    conversationId: string;
    sourceEventId: string | null;
  }): Promise<VoiceUrgencyExpectedFieldOutcome> {
    if (
      params.expectedField !== "comfort_risk" &&
      params.expectedField !== "urgency_confirm"
    ) {
      return { kind: "not_applicable" };
    }

    if (params.binaryIntent === "YES" || params.binaryIntent === "NO") {
      await this.conversationsService.updateVoiceUrgencyConfirmation({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        urgencyConfirmation: {
          askedAt: new Date().toISOString(),
          response: params.binaryIntent,
          sourceEventId: params.sourceEventId ?? null,
        },
      });
      await this.conversationsService.clearVoiceListeningWindow({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
      });
      return {
        kind: "answered",
        preface:
          params.binaryIntent === "YES"
            ? "Thanks. We'll treat this as urgent."
            : "Okay, we'll keep it standard.",
      };
    }

    return { kind: "reprompt" };
  }
}
