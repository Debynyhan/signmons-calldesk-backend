import { Inject, Injectable } from "@nestjs/common";
import { CommunicationChannel } from "@prisma/client";
import { JOB_REPOSITORY } from "../../jobs/jobs.constants";
import type { IJobRepository } from "../../jobs/interfaces/job-repository.interface";
import { ConversationLifecycleService } from "../../conversations/conversation-lifecycle.service";
import { CallLogService } from "../../logging/call-log.service";
import { LoggingService } from "../../logging/logging.service";
import { getRequestContext } from "../../common/context/request-context";
import type {
  RegisteredToolExecutionContext,
  RegisteredToolExecutionResult,
  RegisteredToolExecutor,
} from "./tool.types";

@Injectable()
export class AiCreateJobToolExecutor implements RegisteredToolExecutor {
  readonly toolName = "create_job";

  constructor(
    @Inject(JOB_REPOSITORY) private readonly jobsRepository: IJobRepository,
    private readonly conversationLifecycleService: ConversationLifecycleService,
    private readonly callLogService: CallLogService,
    private readonly loggingService: LoggingService,
  ) {}

  async execute(
    context: RegisteredToolExecutionContext,
  ): Promise<RegisteredToolExecutionResult> {
    if (context.channel === CommunicationChannel.VOICE) {
      const reply =
        "Thanks — I’ll text you to confirm details and secure the appointment.";
      const requestContext = getRequestContext();

      this.loggingService.warn(
        {
          event: "voice.tool_blocked",
          tenantId: context.tenantId,
          callSid: requestContext?.callSid,
          conversationId: context.conversationId,
          toolName: this.toolName,
        },
        "AiService",
      );

      await this.callLogService.createLog({
        tenantId: context.tenantId,
        sessionId: context.sessionId,
        conversationId: context.conversationId,
        transcript: context.rawArgs ?? "",
        aiResponse: reply,
        metadata: { toolName: this.toolName, blocked: "voice_sms_canonical" },
        channel: context.channel,
      });

      return {
        status: "reply",
        reply,
        outcome: "sms_handoff",
        reason: "voice_tool_blocked",
      };
    }

    const job = await this.jobsRepository.createJobFromToolCall({
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      rawArgs: context.rawArgs,
    });

    await this.conversationLifecycleService.linkJobToConversation({
      tenantId: context.tenantId,
      conversationId: context.conversationId,
      jobId: job.id,
    });

    await this.callLogService.createLog({
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      jobId: job.id,
      conversationId: context.conversationId,
      transcript: context.rawArgs ?? "",
      aiResponse: JSON.stringify(job),
      metadata: { toolName: this.toolName, sessionId: context.sessionId },
      channel: context.channel,
    });

    await this.callLogService.clearSession(
      context.tenantId,
      context.sessionId,
      context.conversationId,
    );

    return {
      status: "job_created",
      job,
      message: "Job created successfully.",
    };
  }
}
