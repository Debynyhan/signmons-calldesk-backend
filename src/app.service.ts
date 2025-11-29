import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  getHello(): string {
    return "Signmons CallDesk backend is running.";
  }
}
