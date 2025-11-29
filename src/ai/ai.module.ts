import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import {
  AI_COMPLETION_PROVIDER,
  AI_PROVIDER,
  OPENAI_CLIENT,
} from "./ai.constants";
import { OpenAiProvider } from "./providers/openai.provider";
import { AiProviderService } from "./providers/ai-provider.service";
import { JobsModule } from "../jobs/jobs.module";
import { TenantsModule } from "../tenants/tenants.module";
import { ToolSelectorService } from "./tools/tool-selector.service";
import { AiErrorHandler } from "./ai-error.handler";

@Module({
  imports: [JobsModule, TenantsModule],
  controllers: [AiController],
  providers: [
    {
      provide: OPENAI_CLIENT,
      useFactory: (configService: ConfigService) => {
        const apiKey = configService.get<string>("app.openAiApiKey");
        if (!apiKey) {
          throw new Error(
            "OPENAI_API_KEY is missing; AI responses cannot be generated.",
          );
        }
        return new OpenAI({ apiKey });
      },
      inject: [ConfigService],
    },
    {
      provide: AI_COMPLETION_PROVIDER,
      useClass: OpenAiProvider,
    },
    {
      provide: AI_PROVIDER,
      useClass: AiProviderService,
    },
    ToolSelectorService,
    AiErrorHandler,
    AiService,
  ],
})
export class AiModule {}
