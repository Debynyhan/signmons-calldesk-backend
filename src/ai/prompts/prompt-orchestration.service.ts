import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { readFileSync } from "fs";
import { join } from "path";
import { CommunicationChannel } from "@prisma/client";
import { LoggingService } from "../../logging/logging.service";
import appConfig from "../../config/app.config";
import {
  getAiRouteIntentFromCollectedData,
  type AiRouteIntent,
} from "../routing/ai-route-state";
import type {
  AiChatMessageParam,
  AiCompletionLane,
  AiToolDefinition,
} from "../types/ai-completion.types";

type PromptCatalog = {
  voice: string | null;
  textFallback: string | null;
  router: string | null;
  booking: string | null;
  faq: string | null;
};

export type TextRouterFlowDecisionReason =
  | "enabled"
  | "voice_channel"
  | "global_disabled"
  | "sms_disabled"
  | "webchat_disabled"
  | "tenant_not_allowlisted"
  | "unsupported_channel";

export type TextRouterFlowDecision = {
  enabled: boolean;
  reason: TextRouterFlowDecisionReason;
};

type LaneSelectionOptions = {
  routerFlowEnabled?: boolean;
};

@Injectable()
export class AiPromptOrchestrationService {
  private readonly prompts: PromptCatalog;

  constructor(
    private readonly loggingService: LoggingService,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {
    this.prompts = {
      voice: this.loadPrompt("voicePrompt.txt"),
      textFallback: this.loadPrompt("textFallbackPrompt.txt"),
      router: this.loadPrompt("routerPrompt.txt"),
      booking: this.loadPrompt("bookingPrompt.txt"),
      faq: this.loadPrompt("faqPrompt.txt"),
    };
  }

  isTextChannel(channel?: CommunicationChannel): boolean {
    return channel !== CommunicationChannel.VOICE;
  }

  getConversationRouteIntent(collectedData: unknown): AiRouteIntent | null {
    return getAiRouteIntentFromCollectedData(collectedData);
  }

  getTextRouterFlowDecision(
    tenantId: string,
    channel?: CommunicationChannel,
  ): TextRouterFlowDecision {
    if (channel === CommunicationChannel.VOICE) {
      return { enabled: false, reason: "voice_channel" };
    }

    if (!this.config.aiRouterFlowEnabled) {
      return { enabled: false, reason: "global_disabled" };
    }

    if (
      channel === CommunicationChannel.SMS &&
      !this.config.aiRouterFlowSmsEnabled
    ) {
      return { enabled: false, reason: "sms_disabled" };
    }

    if (
      (channel === undefined || channel === CommunicationChannel.WEBCHAT) &&
      !this.config.aiRouterFlowWebchatEnabled
    ) {
      return { enabled: false, reason: "webchat_disabled" };
    }

    if (
      channel &&
      channel !== CommunicationChannel.SMS &&
      channel !== CommunicationChannel.WEBCHAT
    ) {
      return { enabled: false, reason: "unsupported_channel" };
    }

    if (this.config.aiRouterFlowAllowlistOnly) {
      const allowlist = new Set(
        (this.config.aiRouterFlowTenantAllowlist ?? [])
          .map((id) => id.trim())
          .filter(Boolean),
      );
      if (!allowlist.has(tenantId)) {
        return { enabled: false, reason: "tenant_not_allowlisted" };
      }
    }

    return { enabled: true, reason: "enabled" };
  }

  selectSystemPrompt(
    channel?: CommunicationChannel,
    routeIntent?: AiRouteIntent | null,
    options?: LaneSelectionOptions,
  ): string | null {
    if (channel === CommunicationChannel.VOICE) {
      return this.prompts.voice ?? this.prompts.textFallback;
    }
    if (options?.routerFlowEnabled === false) {
      return this.prompts.textFallback;
    }

    if (routeIntent === "BOOKING") {
      return this.prompts.booking ?? this.prompts.textFallback;
    }

    if (routeIntent === "FAQ") {
      return this.prompts.faq ?? this.prompts.textFallback;
    }

    return this.prompts.router ?? this.prompts.textFallback;
  }

  selectTriageLane(
    channel?: CommunicationChannel,
    routeIntent?: AiRouteIntent | null,
    options?: LaneSelectionOptions,
  ): AiCompletionLane {
    if (channel === CommunicationChannel.VOICE) {
      return "TRIAGE_VOICE";
    }
    if (options?.routerFlowEnabled === false) {
      return "TRIAGE_TEXT_FALLBACK";
    }

    if (routeIntent === "BOOKING") {
      return "TRIAGE_BOOKING";
    }

    if (routeIntent === "FAQ") {
      return "TRIAGE_FAQ";
    }

    return "TRIAGE_ROUTER";
  }

  filterToolsForLane(
    tools: AiToolDefinition[],
    channel?: CommunicationChannel,
    routeIntent?: AiRouteIntent | null,
    options?: LaneSelectionOptions,
  ): AiToolDefinition[] {
    if (channel === CommunicationChannel.VOICE) {
      return tools.filter(
        (tool) => this.getFunctionToolName(tool) !== "route_conversation",
      );
    }

    if (options?.routerFlowEnabled === false) {
      return tools.filter(
        (tool) => this.getFunctionToolName(tool) !== "route_conversation",
      );
    }

    const allowed =
      routeIntent === "BOOKING"
        ? new Set(["route_conversation", "create_job"])
        : new Set(["route_conversation"]);

    return tools.filter((tool) => {
      const name = this.getFunctionToolName(tool);
      return name ? allowed.has(name) : false;
    });
  }

  buildTriageMessages(params: {
    systemPrompt: string;
    tenantContextPrompt: string;
    conversationHistory: AiChatMessageParam[];
    userMessage: string;
    continuationNote?: string;
  }): AiChatMessageParam[] {
    const messages: AiChatMessageParam[] = [
      { role: "system", content: params.systemPrompt },
      { role: "system", content: params.tenantContextPrompt },
    ];
    if (params.continuationNote) {
      messages.push({ role: "system", content: params.continuationNote });
    }
    return [
      ...messages,
      ...params.conversationHistory,
      { role: "user", content: params.userMessage },
    ];
  }

  private loadPrompt(filename: string): string | null {
    try {
      const promptPath = join(process.cwd(), "src", "ai", "prompts", filename);
      return readFileSync(promptPath, "utf8");
    } catch (error) {
      this.loggingService.error(
        `Failed to load prompt: ${filename}`,
        error instanceof Error ? error : undefined,
        AiPromptOrchestrationService.name,
      );
      return null;
    }
  }

  private getFunctionToolName(tool: AiToolDefinition): string | null {
    if (tool.type !== "function" || !("function" in tool)) {
      return null;
    }
    return tool.function?.name ?? null;
  }
}
