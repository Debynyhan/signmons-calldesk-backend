import { Module } from "@nestjs/common";
import { ConfigService, ConfigType } from "@nestjs/config";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AI_COMPLETION_PROVIDER, AI_PROVIDER } from "./ai.constants";
import { OpenAiProvider } from "./providers/openai.provider";
import { AiProviderService } from "./providers/ai-provider.service";
import { JobsModule } from "../jobs/jobs.module";
import { TenantsModule } from "../tenants/tenants.module";
import { ToolSelectorService } from "./tools/tool-selector.service";
import { AiErrorHandler } from "./ai-error.handler";
import appConfig from "../config/app.config";
import { VertexAiProvider } from "./providers/vertex.provider";
import OpenAI from "openai";

@Module({
  imports: [JobsModule, TenantsModule],
  controllers: [AiController],
  providers: [
    {
      provide: AI_COMPLETION_PROVIDER,
      useFactory: (configService: ConfigService) => {
        const app = configService.get<ConfigType<typeof appConfig>>("app");
        const provider =
          configService.get<"openai" | "vertex">("app.aiProvider") ?? "openai";
        if (provider === "vertex") {
          if (!app) {
            throw new Error("Application config is missing.");
          }
          return new VertexAiProvider(app);
        }
        const apiKey = configService.get<string>("app.openAiApiKey");
        if (!apiKey) {
          throw new Error(
            "OPENAI_API_KEY is missing; AI responses cannot be generated.",
          );
        }
        return new OpenAiProvider(new OpenAI({ apiKey }));
      },
      inject: [ConfigService],
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
