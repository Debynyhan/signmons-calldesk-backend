import { Module } from "@nestjs/common";
import { ConversationsService } from "./conversations.service";
import { ConversationsRepository } from "./conversations.repository";
import { ConversationCustomerResolver } from "./conversation-customer-resolver";
import { ConversationLifecycleService } from "./conversation-lifecycle.service";
import { VoiceConversationStateService } from "../voice/voice-conversation-state.service";

@Module({
  providers: [
    ConversationsRepository,
    ConversationCustomerResolver,
    ConversationsService,
    ConversationLifecycleService,
    VoiceConversationStateService,
  ],
  exports: [
    ConversationsRepository,
    ConversationCustomerResolver,
    ConversationsService,
    ConversationLifecycleService,
    VoiceConversationStateService,
  ],
})
export class ConversationsModule {}
