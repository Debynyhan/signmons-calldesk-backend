import { Controller, Get, UseGuards } from "@nestjs/common";
import { FirebaseAuthGuard } from "./auth/firebase-auth.guard";
import { AppService } from "./app.service";

@Controller()
@UseGuards(FirebaseAuthGuard)
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
