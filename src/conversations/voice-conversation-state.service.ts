import { Injectable } from "@nestjs/common";
import type { IVoiceConversationStateService } from "./voice-conversation-state.service.interface";
import { VoiceAddressSlotStateService } from "./voice-state/voice-address-slot-state.service";
import { VoiceNameSlotStateService } from "./voice-state/voice-name-slot-state.service";
import { VoiceSmsSlotStateService } from "./voice-state/voice-sms-slot-state.service";
import { VoiceTranscriptStateService } from "./voice-state/voice-transcript-state.service";
import { VoiceTurnOrchestrationStateService } from "./voice-state/voice-turn-orchestration-state.service";

type VoiceStateParams<T extends keyof IVoiceConversationStateService> =
  Parameters<IVoiceConversationStateService[T]>[0];

@Injectable()
export class VoiceConversationStateService
  implements IVoiceConversationStateService
{
  constructor(
    private readonly transcriptStateService: VoiceTranscriptStateService,
    private readonly nameSlotStateService: VoiceNameSlotStateService,
    private readonly addressSlotStateService: VoiceAddressSlotStateService,
    private readonly smsSlotStateService: VoiceSmsSlotStateService,
    private readonly turnOrchestrationStateService: VoiceTurnOrchestrationStateService,
  ) {}

  updateVoiceTranscript(
    params: VoiceStateParams<"updateVoiceTranscript">,
  ) {
    return this.transcriptStateService.updateVoiceTranscript(params);
  }

  updateVoiceIssueCandidate(
    params: VoiceStateParams<"updateVoiceIssueCandidate">,
  ) {
    return this.turnOrchestrationStateService.updateVoiceIssueCandidate(params);
  }

  incrementVoiceTurn(
    params: VoiceStateParams<"incrementVoiceTurn">,
  ) {
    return this.turnOrchestrationStateService.incrementVoiceTurn(params);
  }

  updateVoiceNameState(
    params: VoiceStateParams<"updateVoiceNameState">,
  ) {
    return this.nameSlotStateService.updateVoiceNameState(params);
  }

  updateVoiceSmsPhoneState(
    params: VoiceStateParams<"updateVoiceSmsPhoneState">,
  ) {
    return this.smsSlotStateService.updateVoiceSmsPhoneState(params);
  }

  updateVoiceSmsHandoff(
    params: VoiceStateParams<"updateVoiceSmsHandoff">,
  ) {
    return this.smsSlotStateService.updateVoiceSmsHandoff(params);
  }

  updateVoiceComfortRisk(
    params: VoiceStateParams<"updateVoiceComfortRisk">,
  ) {
    return this.turnOrchestrationStateService.updateVoiceComfortRisk(params);
  }

  updateVoiceUrgencyConfirmation(
    params: VoiceStateParams<"updateVoiceUrgencyConfirmation">,
  ) {
    return this.turnOrchestrationStateService.updateVoiceUrgencyConfirmation(
      params,
    );
  }

  clearVoiceSmsHandoff(
    params: VoiceStateParams<"clearVoiceSmsHandoff">,
  ) {
    return this.smsSlotStateService.clearVoiceSmsHandoff(params);
  }

  updateVoiceAddressState(
    params: VoiceStateParams<"updateVoiceAddressState">,
  ) {
    return this.addressSlotStateService.updateVoiceAddressState(params);
  }

  updateVoiceListeningWindow(
    params: VoiceStateParams<"updateVoiceListeningWindow">,
  ) {
    return this.turnOrchestrationStateService.updateVoiceListeningWindow(params);
  }

  clearVoiceListeningWindow(
    params: VoiceStateParams<"clearVoiceListeningWindow">,
  ) {
    return this.turnOrchestrationStateService.clearVoiceListeningWindow(params);
  }

  updateVoiceLastEventId(
    params: VoiceStateParams<"updateVoiceLastEventId">,
  ) {
    return this.turnOrchestrationStateService.updateVoiceLastEventId(params);
  }

  appendVoiceTurnTiming(
    params: VoiceStateParams<"appendVoiceTurnTiming">,
  ) {
    return this.turnOrchestrationStateService.appendVoiceTurnTiming(params);
  }

  promoteNameFromSms(
    params: VoiceStateParams<"promoteNameFromSms">,
  ) {
    return this.nameSlotStateService.promoteNameFromSms(params);
  }

  promoteAddressFromSms(
    params: VoiceStateParams<"promoteAddressFromSms">,
  ) {
    return this.addressSlotStateService.promoteAddressFromSms(params);
  }
}
