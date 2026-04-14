import { Inject, Injectable } from "@nestjs/common";
import type { Response } from "express";
import type {
  VoiceAddressState,
  VoiceListeningWindow,
  VoiceNameState,
  VoiceSmsPhoneState,
} from "../conversations/voice-conversation-state.codec";
import { CsrStrategy } from "./csr-strategy.selector";
import {
  buildVoiceListeningWindowReprompt,
  getExpectedVoiceListeningField,
  isVoiceListeningWindowExpired,
  shouldClearVoiceListeningWindow,
} from "./intake/voice-listening-window.policy";
import { VoiceAddressPromptService } from "./voice-address-prompt.service";
import { VOICE_TURN_ORCHESTRATION_SERVICE, type IVoiceTurnOrchestration } from "./voice-turn-orchestration.service.interface";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";
import { VoiceResponseService } from "./voice-response.service";

type VoiceExpectedField =
  | "name"
  | "address"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

@Injectable()
export class VoiceListeningWindowService {
  constructor(
    private readonly voiceResponseService: VoiceResponseService,
    private readonly voicePromptComposer: VoicePromptComposerService,
    private readonly voiceAddressPromptService: VoiceAddressPromptService,
    @Inject(VOICE_TURN_ORCHESTRATION_SERVICE) private readonly voiceConversationStateService: IVoiceTurnOrchestration,
  ) {}

  getVoiceListeningWindow(collectedData: unknown): VoiceListeningWindow | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const data = collectedData as Record<string, unknown>;
    const raw = data.voiceListeningWindow;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const window = raw as Record<string, unknown>;
    const field = window.field;
    if (
      field !== "name" &&
      field !== "address" &&
      field !== "confirmation" &&
      field !== "sms_phone" &&
      field !== "comfort_risk" &&
      field !== "urgency_confirm"
    ) {
      return null;
    }
    const expiresAt =
      typeof window.expiresAt === "string" ? window.expiresAt : null;
    if (!expiresAt) {
      return null;
    }
    const targetField =
      window.targetField === "name" ||
      window.targetField === "address" ||
      window.targetField === "booking" ||
      window.targetField === "callback" ||
      window.targetField === "comfort_risk" ||
      window.targetField === "urgency_confirm"
        ? window.targetField
        : undefined;
    return {
      field,
      sourceEventId:
        typeof window.sourceEventId === "string" ? window.sourceEventId : null,
      expiresAt,
      ...(targetField ? { targetField } : {}),
    };
  }

  getVoiceLastEventId(collectedData: unknown): string | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const data = collectedData as Record<string, unknown>;
    return typeof data.voiceLastEventId === "string"
      ? data.voiceLastEventId
      : null;
  }

  isListeningWindowExpired(window: VoiceListeningWindow, now: Date): boolean {
    return isVoiceListeningWindowExpired(window, now);
  }

  getExpectedListeningField(
    window: VoiceListeningWindow | null,
  ): VoiceExpectedField | null {
    return getExpectedVoiceListeningField(window);
  }

  shouldClearListeningWindow(
    window: VoiceListeningWindow,
    now: Date,
    nameState: VoiceNameState,
    addressState: VoiceAddressState,
    phoneState: VoiceSmsPhoneState,
  ): boolean {
    return shouldClearVoiceListeningWindow({
      window,
      now,
      nameState,
      addressState,
      phoneState,
    });
  }

  buildListeningWindowReprompt(params: {
    window: VoiceListeningWindow | null;
    addressState: VoiceAddressState;
    strategy?: CsrStrategy;
  }): string {
    return buildVoiceListeningWindowReprompt({
      window: params.window,
      addressState: params.addressState,
      strategy: params.strategy,
      buildAskNameTwiml: (strategy) =>
        this.voicePromptComposer.buildAskNameTwiml(
          strategy as CsrStrategy | undefined,
        ),
      buildAddressPromptForState: (addressState, strategy) =>
        this.voiceAddressPromptService.buildAddressPromptForState({
          addressState: addressState as VoiceAddressState,
          strategy: strategy as CsrStrategy | undefined,
          applyCsrStrategy: (s, message) =>
            this.voicePromptComposer.applyCsrStrategy(
              s as CsrStrategy | undefined,
              message,
            ),
        }),
      buildAskSmsNumberTwiml: (strategy) =>
        this.voicePromptComposer.buildAskSmsNumberTwiml(
          strategy as CsrStrategy | undefined,
        ),
      buildBookingPromptTwiml: (strategy) =>
        this.voicePromptComposer.buildBookingPromptTwiml(
          strategy as CsrStrategy | undefined,
        ),
      buildCallbackOfferTwiml: (strategy) =>
        this.voicePromptComposer.buildCallbackOfferTwiml(
          strategy as CsrStrategy | undefined,
        ),
      buildUrgencyConfirmTwiml: (strategy) =>
        this.voicePromptComposer.buildUrgencyConfirmTwiml(
          strategy as CsrStrategy | undefined,
        ),
      buildRepromptTwiml: (strategy) =>
        this.voicePromptComposer.buildRepromptTwiml(
          strategy as CsrStrategy | undefined,
        ),
    });
  }

  async replyWithListeningWindow(params: {
    res?: Response;
    tenantId: string;
    conversationId: string;
    field: VoiceListeningWindow["field"];
    sourceEventId: string | null;
    twiml: string;
    timeoutSec?: number;
    targetField?: VoiceListeningWindow["targetField"];
  }): Promise<string> {
    const timeoutSec =
      params.timeoutSec ??
      (params.field === "address" || params.targetField === "address"
        ? 24
        : params.field === "sms_phone"
          ? 20
          : 8);
    const expiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();
    await this.voiceConversationStateService.updateVoiceListeningWindow({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      window: {
        field: params.field,
        sourceEventId: params.sourceEventId,
        expiresAt,
        ...(params.targetField ? { targetField: params.targetField } : {}),
      },
    });
    return this.voiceResponseService.replyWithTwiml(params.res, params.twiml);
  }

  async clearVoiceListeningWindow(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<void> {
    await this.voiceConversationStateService.clearVoiceListeningWindow(params);
  }
}
