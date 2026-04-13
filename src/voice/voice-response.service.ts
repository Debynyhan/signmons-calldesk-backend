import { Inject, Injectable } from "@nestjs/common";
import type { Response } from "express";
import { CALL_LOG_SERVICE, type ICallLogService } from "../logging/call-log.service.interface";
import { LoggingService } from "../logging/logging.service";
import { getRequestContext } from "../common/context/request-context";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";
import { VoiceCallStateService } from "./voice-call-state.service";

type VoiceOutcome = "sms_handoff" | "human_fallback" | "no_handoff";

@Injectable()
export class VoiceResponseService {
  constructor(
    @Inject(CALL_LOG_SERVICE) private readonly callLogService: ICallLogService,
    private readonly loggingService: LoggingService,
    private readonly voicePromptComposer: VoicePromptComposerService,
    private readonly voiceCallStateService: VoiceCallStateService,
  ) {}

  async replyWithTwiml(
    res: Response | undefined,
    twiml: string,
  ): Promise<string> {
    const context = getRequestContext();
    const callSid =
      context?.channel === "VOICE" && context.callSid ? context.callSid : null;
    const suppress =
      callSid !== null &&
      this.voiceCallStateService.shouldSuppressDuplicateResponse(callSid, twiml);
    if (!suppress) {
      await this.logVoiceAssistantMessages(twiml);
    }
    if (res) {
      res.status(200).type("text/xml").send(twiml);
    }
    return twiml;
  }

  async replyWithHumanFallback(params: {
    res?: Response;
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    displayName?: string;
    reason: string;
    messageOverride?: string;
  }): Promise<string> {
    this.logVoiceOutcome({
      outcome: "human_fallback",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });
    this.clearIssuePromptAttempts(params.callSid);
    const message = params.messageOverride ?? "We'll follow up shortly.";
    return this.replyWithTwiml(
      params.res,
      this.voicePromptComposer.buildClosingTwiml(params.displayName ?? "", message),
    );
  }

  async replyWithNoHandoff(params: {
    res?: Response;
    reason: string;
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    twimlOverride?: string;
  }): Promise<string> {
    this.logVoiceOutcome({
      outcome: "no_handoff",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: params.reason,
    });
    this.clearIssuePromptAttempts(params.callSid);
    return this.replyWithTwiml(
      params.res,
      params.twimlOverride ?? this.voicePromptComposer.unroutableTwiml(),
    );
  }

  getIssuePromptAttempts(callSid: string): number {
    return this.voiceCallStateService.getIssuePromptAttempts(callSid);
  }

  setIssuePromptAttempts(callSid: string, count: number): void {
    this.voiceCallStateService.setIssuePromptAttempts(callSid, count);
  }

  clearIssuePromptAttempts(callSid: string | undefined): void {
    this.voiceCallStateService.clearIssuePromptAttempts(callSid);
  }

  private logVoiceOutcome(params: {
    outcome: VoiceOutcome;
    tenantId?: string;
    conversationId?: string;
    callSid?: string;
    reason: string;
  }): void {
    this.loggingService.log(
      {
        event: "voice.outcome",
        outcome: params.outcome,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        reason: params.reason,
      },
      VoiceResponseService.name,
    );
  }

  private async logVoiceAssistantMessages(twiml: string): Promise<void> {
    const context = getRequestContext();
    if (
      !context ||
      context.channel !== "VOICE" ||
      !context.tenantId ||
      !context.conversationId ||
      !context.callSid
    ) {
      return;
    }
    const messages = this.voicePromptComposer.extractSayMessages(twiml);
    if (!messages.length) {
      return;
    }
    const baseSourceEventId = context.sourceEventId ?? undefined;
    await Promise.all(
      messages.map((message, index) =>
        this.callLogService.createVoiceAssistantLog({
          tenantId: context.tenantId as string,
          conversationId: context.conversationId as string,
          callSid: context.callSid as string,
          message,
          occurredAt: new Date(),
          sourceEventId: baseSourceEventId
            ? `${baseSourceEventId}:${index}`
            : undefined,
        }),
      ),
    );
  }
}
