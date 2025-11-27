import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { OPENAI_CLIENT } from "./ai.constants";

@Module({
  controllers: [AiController],
  providers: [
    {
      provide: OPENAI_CLIENT,
      useFactory: (configService: ConfigService) => {
        const apiKey = configService.get<string>("OPENAI_API_KEY");
        return apiKey ? new OpenAI({ apiKey }) : null;
      },
      inject: [ConfigService],
    },
    AiService,
  ],
})
export class AiModule {}
