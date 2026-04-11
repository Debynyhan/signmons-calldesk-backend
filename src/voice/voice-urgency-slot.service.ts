import { Injectable } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service";
import { VoiceConversationStateService } from "./voice-conversation-state.service";

export type VoiceUrgencyBinaryIntent = "YES" | "NO" | null;

export type VoiceUrgencyExpectedFieldOutcome =
  | { kind: "not_applicable" }
  | { kind: "answered"; preface: string }
  | { kind: "reprompt" };

@Injectable()
export class VoiceUrgencySlotService {
  private readonly stateServiceDependency?: VoiceConversationStateService;

  constructor(
    private readonly conversationsService: ConversationsService,
    voiceConversationStateService?: VoiceConversationStateService,
  ) {
    this.stateServiceDependency = voiceConversationStateService;
  }

  private get stateService(): Pick<
    VoiceConversationStateService,
    "updateVoiceUrgencyConfirmation" | "clearVoiceListeningWindow"
  > {
    const legacy = this.conversationsService as Partial<VoiceConversationStateService>;
    if (
      typeof legacy.updateVoiceUrgencyConfirmation === "function" &&
      typeof legacy.clearVoiceListeningWindow === "function"
    ) {
      return legacy as Pick<
        VoiceConversationStateService,
        "updateVoiceUrgencyConfirmation" | "clearVoiceListeningWindow"
      >;
    }
    return this.stateServiceDependency as Pick<
      VoiceConversationStateService,
      "updateVoiceUrgencyConfirmation" | "clearVoiceListeningWindow"
    >;
  }

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
      await this.stateService.updateVoiceUrgencyConfirmation({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        urgencyConfirmation: {
          askedAt: new Date().toISOString(),
          response: params.binaryIntent,
          sourceEventId: params.sourceEventId ?? null,
        },
      });
      await this.stateService.clearVoiceListeningWindow({
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
