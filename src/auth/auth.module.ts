import { Module } from "@nestjs/common";
import { FirebaseAdminService } from "./firebase-admin.service";
import { RequestAuthGuard } from "./request-auth.guard";

@Module({
  providers: [FirebaseAdminService, RequestAuthGuard],
  exports: [FirebaseAdminService, RequestAuthGuard],
})
export class AuthModule {}
