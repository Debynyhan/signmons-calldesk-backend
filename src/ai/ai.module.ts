import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AI_SERVICE } from "./ai.service.interface";
import {
  AI_COMPLETION_PROVIDER,
  AI_PROVIDER,
  OPENAI_CLIENT,
} from "./ai.constants";
import { OpenAiProvider } from "./providers/openai.provider";
import { AiProviderService } from "./providers/ai-provider.service";
import { JobsModule } from "../jobs/jobs.module";
import { TenantsModule } from "../tenants/tenants.module";
import { AiToolRegistrar } from "./tools/ai-tool.registrar";
import { AiToolExecutorRegistrar } from "./tools/ai-tool-executor.registrar";
import { ToolSelectorService } from "./tools/tool-selector.service";
import { AiErrorHandler } from "./ai-error.handler";
import { TenantGuard } from "../common/guards/tenant.guard";
import { AuthModule } from "../auth/auth.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { AiPromptOrchestrationService } from "./prompts/prompt-orchestration.service";
import { ToolExecutorRegistryService } from "./tools/tool-executor.registry";
import { RouteConversationToolExecutor } from "./tools/route-conversation.executor";
import { AiCreateJobToolExecutor } from "./tools/create-job.executor";
import { ToolRegistryModule } from "./tools/tool-registry.module";
import { AiExtractionService } from "./ai-extraction.service";
import { TriageOrchestratorService } from "./triage-orchestrator.service";
import { TriageContextBuilderService } from "./triage-context-builder.service";
import { ToolDispatchService } from "./tool-dispatch.service";

@Module({
  imports: [
    JobsModule,
    TenantsModule,
    AuthModule,
    ToolRegistryModule,
    ConversationsModule,
  ],
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
    AiToolRegistrar,
    ToolExecutorRegistryService,
    RouteConversationToolExecutor,
    AiCreateJobToolExecutor,
    AiToolExecutorRegistrar,
    TenantGuard,
    ToolSelectorService,
    AiPromptOrchestrationService,
    AiErrorHandler,
    AiExtractionService,
    ToolDispatchService,
    TriageOrchestratorService,
    TriageContextBuilderService,
    AiService,
    {
      provide: AI_SERVICE,
      useExisting: AiService,
    },
  ],
  exports: [
    AiExtractionService,
    ToolDispatchService,
    TriageOrchestratorService,
    AI_SERVICE,
    AiService,
  ],
})
export class AiModule {}
