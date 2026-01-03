import { Module } from "@nestjs/common";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { FirebaseAuthGuard } from "../auth/firebase-auth.guard";
import { TenantGuard } from "../common/guards/tenant.guard";

@Module({
  imports: [SanitizationModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, FirebaseAuthGuard, TenantGuard],
  exports: [ConversationsService],
})
export class ConversationsModule {}
