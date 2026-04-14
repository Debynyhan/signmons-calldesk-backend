import type { Prisma, TenantOrganization } from "@prisma/client";
import type { Response } from "express";
import type { AppConfig } from "../config/app.config";
import type { IConversationsService } from "../conversations/conversations.service.interface";
import type { IVoiceTranscriptState } from "./voice-transcript-state.service.interface";
import type { IVoiceTurnOrchestration } from "./voice-turn-orchestration.service.interface";
import type { ICallLogService } from "../logging/call-log.service.interface";

type TurnConversationLike = {
  id: string;
  collectedData: Prisma.JsonValue | null;
  currentFSMState?: string | null;
};

type TurnStateLike = {
  voiceTurnCount: number;
  voiceStartedAt: string;
};

type TurnPreludePolicy = {
  getVoiceListeningWindow: (collectedData: Prisma.JsonValue | null) => unknown;
  getExpectedListeningField: (listeningWindow: unknown) => string | null;
  shouldIgnoreStreamingTranscript: (
    transcript: string,
    collectedData: Prisma.JsonValue | null,
    expectedField: string | null,
  ) => boolean;
  isDuplicateTranscript: (
    collectedData: Prisma.JsonValue | null,
    transcript: string,
    now: Date,
  ) => boolean;
  normalizeConfidence: (value: string | number | null) => number | undefined;
  getTenantDisplayName: (tenant: TenantOrganization) => string;
  buildRepromptTwiml: () => string;
  buildSayGatherTwiml: (message: string) => string;
  replyWithTwiml: (
    res: Response | undefined,
    twiml: string,
  ) => Promise<string>;
  replyWithNoHandoff: (params: {
    res?: Response;
    tenantId: string;
    conversationId?: string;
    callSid?: string;
    reason: string;
  }) => Promise<string>;
  replyWithHumanFallback: (params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    callSid?: string;
    displayName: string;
    reason: string;
    messageOverride?: string;
  }) => Promise<string>;
};

type TurnPreludeInput = {
  res?: Response;
  tenant: TenantOrganization;
  callSid: string;
  speechResult?: string | null;
  confidence?: string | number | null;
};

type TurnPreludeReady = {
  kind: "ready";
  now: Date;
  normalizedSpeech: string;
  confidence: number | undefined;
  voiceTurnCount: number;
  displayName: string;
  currentEventId: string;
  conversation: TurnConversationLike;
  updatedConversation: TurnConversationLike | null;
  conversationId: string;
  collectedData: Prisma.JsonValue | null;
};

type TurnPreludeExit = {
  kind: "exit";
  value: string;
};

export type TurnPreludeResult = TurnPreludeReady | TurnPreludeExit;

export class VoiceTurnPreludeRuntime {
  constructor(
    private readonly config: AppConfig,
    private readonly conversationsService: IConversationsService,
    private readonly voiceConversationStateService: IVoiceTranscriptState &
      Pick<IVoiceTurnOrchestration, "incrementVoiceTurn">,
    private readonly callLogService: ICallLogService,
    private readonly policy: TurnPreludePolicy,
  ) {}

  async prepare(input: TurnPreludeInput): Promise<TurnPreludeResult> {
    const { tenant, callSid, res } = input;

    const conversation =
      await this.conversationsService.getVoiceConversationByCallSid({
        tenantId: tenant.id,
        callSid,
      });
    const consentGranted = Boolean(
      (conversation?.collectedData as { voiceConsent?: { granted?: boolean } })
        ?.voiceConsent?.granted,
    );
    if (!consentGranted) {
      return {
        kind: "exit",
        value: await this.policy.replyWithNoHandoff({
          res,
          tenantId: tenant.id,
          callSid,
          reason: "consent_missing",
        }),
      };
    }

    if (!conversation) {
      return {
        kind: "exit",
        value: await this.policy.replyWithNoHandoff({
          res,
          tenantId: tenant.id,
          callSid,
          reason: "conversation_missing",
        }),
      };
    }

    const now = new Date();
    const speechResult = input.speechResult ?? null;
    const normalizedSpeech = speechResult
      ? speechResult.replace(/\s+/g, " ").trim()
      : "";
    if (!normalizedSpeech) {
      return {
        kind: "exit",
        value: res
          ? await this.policy.replyWithTwiml(
              res,
              this.policy.buildRepromptTwiml(),
            )
          : "",
      };
    }

    const collectedDataSnapshot = conversation.collectedData ?? null;
    const listeningWindowSnapshot = this.policy.getVoiceListeningWindow(
      collectedDataSnapshot,
    );
    const expectedFieldSnapshot = this.policy.getExpectedListeningField(
      listeningWindowSnapshot,
    );
    if (
      !res &&
      this.policy.shouldIgnoreStreamingTranscript(
        normalizedSpeech,
        collectedDataSnapshot,
        expectedFieldSnapshot,
      )
    ) {
      return { kind: "exit", value: "" };
    }
    if (
      !res &&
      this.policy.isDuplicateTranscript(
        conversation?.collectedData,
        normalizedSpeech,
        now,
      )
    ) {
      return { kind: "exit", value: "" };
    }

    const turnState = (await this.voiceConversationStateService.incrementVoiceTurn({
      tenantId: tenant.id,
      conversationId: conversation.id,
      now,
    })) as TurnStateLike | null;

    if (!turnState) {
      return {
        kind: "exit",
        value: await this.policy.replyWithNoHandoff({
          res,
          tenantId: tenant.id,
          conversationId: conversation.id,
          callSid,
          reason: "turn_state_missing",
        }),
      };
    }

    const voiceTurnCount = turnState.voiceTurnCount;
    const maxTurns = Math.max(1, this.config.voiceMaxTurns ?? 6);
    const maxDurationSec = Math.max(30, this.config.voiceMaxDurationSec ?? 180);
    const startedAt = new Date(turnState.voiceStartedAt);
    const elapsedSec = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
    const displayName = this.policy.getTenantDisplayName(tenant);
    if (turnState.voiceTurnCount > maxTurns || elapsedSec > maxDurationSec) {
      return {
        kind: "exit",
        value: await this.policy.replyWithHumanFallback({
          res,
          tenantId: tenant.id,
          conversationId: conversation.id,
          callSid,
          displayName,
          reason:
            turnState.voiceTurnCount > maxTurns
              ? "max_turns_exceeded"
              : "max_duration_exceeded",
        }),
      };
    }

    if (
      this.policy.isDuplicateTranscript(
        conversation?.collectedData,
        normalizedSpeech,
        now,
      )
    ) {
      return {
        kind: "exit",
        value: await this.policy.replyWithTwiml(
          res,
          this.policy.buildSayGatherTwiml(
            "Thanks, I heard that. Please continue.",
          ),
        ),
      };
    }

    const confidence = this.policy.normalizeConfidence(input.confidence ?? null);
    const updatedConversation =
      (await this.voiceConversationStateService.updateVoiceTranscript({
        tenantId: tenant.id,
        callSid,
        transcript: normalizedSpeech,
        confidence,
      })) as TurnConversationLike | null;

    let transcriptEventId: string | null = null;
    if (updatedConversation) {
      transcriptEventId = await this.callLogService.createVoiceTranscriptLog({
        tenantId: tenant.id,
        conversationId: updatedConversation.id,
        callSid,
        transcript: normalizedSpeech,
        confidence,
        occurredAt: new Date(),
      });
    }

    const conversationId = updatedConversation?.id ?? conversation?.id;
    if (!conversationId) {
      return {
        kind: "exit",
        value: await this.policy.replyWithNoHandoff({
          res,
          tenantId: tenant.id,
          callSid,
          reason: "conversation_id_missing",
        }),
      };
    }
    if (!transcriptEventId) {
      return {
        kind: "exit",
        value: await this.policy.replyWithNoHandoff({
          res,
          tenantId: tenant.id,
          conversationId,
          callSid,
          reason: "transcript_event_missing",
        }),
      };
    }

    return {
      kind: "ready",
      now,
      normalizedSpeech,
      confidence,
      voiceTurnCount,
      displayName,
      currentEventId: transcriptEventId,
      conversation,
      updatedConversation,
      conversationId,
      collectedData: updatedConversation?.collectedData ?? conversation.collectedData,
    };
  }
}
