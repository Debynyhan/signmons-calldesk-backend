import { Module } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import OpenAI from "openai";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import {
  AI_COMPLETION_PROVIDER,
  OPENAI_CLIENT,
} from "./ai.constants";
import appConfig from "../config/app.config";
import { OpenAiProvider } from "./providers/openai.provider";
import { AiProviderService } from "./providers/ai-provider.service";
import { JobsModule } from "../jobs/jobs.module";
import { TenantsModule } from "../tenants/tenants.module";
import { ToolRegistryService } from "./tools/tool.provider";
import { ToolSelectorService } from "./tools/tool-selector.service";
import { AiErrorHandler } from "./ai-error.handler";

@Module({
  imports: [JobsModule, TenantsModule],
  controllers: [AiController],
  providers: [
    {
      provide: OPENAI_CLIENT,
      useFactory: (config: ConfigType<typeof appConfig>) => {
        if (!config.openAiApiKey) {
          throw new Error(
            "OPENAI_API_KEY is missing; AI responses cannot be generated."
          );
        }
        return new OpenAI({ apiKey: config.openAiApiKey });
      },
      inject: [appConfig.KEY],
    },
    {
      provide: AI_COMPLETION_PROVIDER,
      useClass: OpenAiProvider,
    },
    AiProviderService,
    ToolSelectorService,
    AiErrorHandler,
    AiService,
  ],
})
export class AiModule {}
