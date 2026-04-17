import { Inject, Injectable } from "@nestjs/common";
import appConfig, { type AppConfig } from "../config/app.config";
import {
  CONVERSATIONS_SERVICE,
  type IConversationsService,
} from "../conversations/conversations.service.interface";
import { CsrStrategySelector } from "./csr-strategy.selector";
import {
  CALL_LOG_SERVICE,
  type ICallLogService,
} from "../logging/call-log.service.interface";
import { VoiceSmsPhoneSlotService } from "./voice-sms-phone-slot.service";
import { VoiceUrgencySlotService } from "./voice-urgency-slot.service";
import { VoiceTurnDependencies } from "./voice-turn.dependencies";
import type { VoiceTurnRuntimeSet } from "./voice-turn-runtime.types";
import {
  createTurnContextRuntime,
  createTurnEarlyRoutingRuntime,
  createTurnExpectedFieldRuntime,
  createTurnPreludeRuntime,
} from "./voice-turn-prelude-context.runtime-builders";

@Injectable()
export class VoiceTurnPreludeContextFactory {
  private runtimes!: VoiceTurnRuntimeSet;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly deps: VoiceTurnDependencies,
    @Inject(CONVERSATIONS_SERVICE)
    private readonly conversationsService: IConversationsService,
    @Inject(CALL_LOG_SERVICE)
    private readonly callLogService: ICallLogService,
    private readonly csrStrategySelector: CsrStrategySelector,
    private readonly voiceSmsPhoneSlotService: VoiceSmsPhoneSlotService,
    private readonly voiceUrgencySlotService: VoiceUrgencySlotService,
  ) {}

  configure(runtimes: VoiceTurnRuntimeSet): void {
    this.runtimes = runtimes;

    runtimes.turnPreludeRuntime = createTurnPreludeRuntime({
      config: this.config,
      deps: this.deps,
      conversationsService: this.conversationsService,
      callLogService: this.callLogService,
    });

    runtimes.turnContextRuntime = createTurnContextRuntime({
      deps: this.deps,
      csrStrategySelector: this.csrStrategySelector,
    });

    runtimes.turnEarlyRoutingRuntime = createTurnEarlyRoutingRuntime({
      deps: this.deps,
      voiceUrgencySlotService: this.voiceUrgencySlotService,
      runtimes: this.runtimes,
    });

    runtimes.turnExpectedFieldRuntime = createTurnExpectedFieldRuntime({
      deps: this.deps,
      voiceSmsPhoneSlotService: this.voiceSmsPhoneSlotService,
      runtimes: this.runtimes,
    });
  }
}
