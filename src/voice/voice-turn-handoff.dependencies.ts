import { Injectable } from "@nestjs/common";
import { VoiceHandoffPolicyService } from "./voice-handoff-policy.service";
import { VoiceSmsHandoffService } from "./voice-sms-handoff.service";

@Injectable()
export class VoiceTurnHandoffDependencies {
  constructor(
    public readonly voiceHandoffPolicy: VoiceHandoffPolicyService,
    public readonly voiceSmsHandoffService: VoiceSmsHandoffService,
  ) {}
}
