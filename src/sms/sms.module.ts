import { Module } from "@nestjs/common";
import { SmsController } from "./sms.controller";
import { ConversationsService } from "../conversations/conversations.service";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { AdminApiGuard } from "../common/guards/admin-api.guard";

@Module({
  imports: [PrismaModule, SanitizationModule],
  controllers: [SmsController],
  providers: [ConversationsService, AdminApiGuard],
})
export class SmsModule {}
