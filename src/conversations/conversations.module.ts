import { Module } from "@nestjs/common";
import { ConversationsService } from "./conversations.service";
import { CONVERSATIONS_SERVICE } from "./conversations.service.interface";
import { ConversationsRepository } from "./conversations.repository";
import { ConversationCustomerResolver } from "./conversation-customer-resolver";
import { ConversationLifecycleService } from "./conversation-lifecycle.service";
import { CONVERSATION_LIFECYCLE_SERVICE } from "./conversation-lifecycle.service.interface";
import { VoiceConversationStateService } from "../voice/voice-conversation-state.service";
import { VOICE_CONVERSATION_STATE_SERVICE } from "../voice/voice-conversation-state.service.interface";
import { VOICE_TRANSCRIPT_STATE_SERVICE } from "../voice/voice-transcript-state.service.interface";
import { VOICE_NAME_SLOT_SERVICE } from "../voice/voice-name-slot.service.interface";
import { VOICE_ADDRESS_SLOT_SERVICE } from "../voice/voice-address-slot.service.interface";
import { VOICE_SMS_SLOT_SERVICE } from "../voice/voice-sms-slot.service.interface";
import { VOICE_TURN_ORCHESTRATION_SERVICE } from "../voice/voice-turn-orchestration.service.interface";

@Module({
  providers: [
    ConversationsRepository,
    ConversationCustomerResolver,
    ConversationsService,
    { provide: CONVERSATIONS_SERVICE, useExisting: ConversationsService },
    ConversationLifecycleService,
    { provide: CONVERSATION_LIFECYCLE_SERVICE, useExisting: ConversationLifecycleService },
    VoiceConversationStateService,
    { provide: VOICE_CONVERSATION_STATE_SERVICE, useExisting: VoiceConversationStateService },
    { provide: VOICE_TRANSCRIPT_STATE_SERVICE, useExisting: VoiceConversationStateService },
    { provide: VOICE_NAME_SLOT_SERVICE, useExisting: VoiceConversationStateService },
    { provide: VOICE_ADDRESS_SLOT_SERVICE, useExisting: VoiceConversationStateService },
    { provide: VOICE_SMS_SLOT_SERVICE, useExisting: VoiceConversationStateService },
    { provide: VOICE_TURN_ORCHESTRATION_SERVICE, useExisting: VoiceConversationStateService },
  ],
  exports: [
    ConversationsRepository,
    ConversationCustomerResolver,
    ConversationsService,
    CONVERSATIONS_SERVICE,
    ConversationLifecycleService,
    CONVERSATION_LIFECYCLE_SERVICE,
    VoiceConversationStateService,
    VOICE_CONVERSATION_STATE_SERVICE,
    VOICE_TRANSCRIPT_STATE_SERVICE,
    VOICE_NAME_SLOT_SERVICE,
    VOICE_ADDRESS_SLOT_SERVICE,
    VOICE_SMS_SLOT_SERVICE,
    VOICE_TURN_ORCHESTRATION_SERVICE,
  ],
})
export class ConversationsModule {}
