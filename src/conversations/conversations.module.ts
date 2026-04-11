import { Module } from "@nestjs/common";
import { ConversationsService } from "./conversations.service";
import { ConversationsRepository } from "./conversations.repository";
import { VoiceConversationStateService } from "../voice/voice-conversation-state.service";

@Module({
  providers: [
    ConversationsRepository,
    ConversationsService,
    VoiceConversationStateService,
  ],
  exports: [
    ConversationsRepository,
    ConversationsService,
    VoiceConversationStateService,
  ],
})
export class ConversationsModule {}
