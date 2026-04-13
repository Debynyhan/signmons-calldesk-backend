import { Module } from "@nestjs/common";
import { ConversationsService } from "./conversations.service";
import { ConversationsRepository } from "./conversations.repository";
import { ConversationCustomerResolver } from "./conversation-customer-resolver";
import { ConversationLifecycleService } from "./conversation-lifecycle.service";
import { CONVERSATION_LIFECYCLE_SERVICE } from "./conversation-lifecycle.service.interface";
import { VoiceConversationStateService } from "../voice/voice-conversation-state.service";
import { VOICE_CONVERSATION_STATE_SERVICE } from "../voice/voice-conversation-state.service.interface";

@Module({
  providers: [
    ConversationsRepository,
    ConversationCustomerResolver,
    ConversationsService,
    ConversationLifecycleService,
    { provide: CONVERSATION_LIFECYCLE_SERVICE, useExisting: ConversationLifecycleService },
    VoiceConversationStateService,
    { provide: VOICE_CONVERSATION_STATE_SERVICE, useExisting: VoiceConversationStateService },
  ],
  exports: [
    ConversationsRepository,
    ConversationCustomerResolver,
    ConversationsService,
    ConversationLifecycleService,
    CONVERSATION_LIFECYCLE_SERVICE,
    VoiceConversationStateService,
    VOICE_CONVERSATION_STATE_SERVICE,
  ],
})
export class ConversationsModule {}
