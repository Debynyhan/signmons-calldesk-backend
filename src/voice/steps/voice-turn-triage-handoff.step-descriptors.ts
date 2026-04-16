import { getVoiceUrgencyConfirmationFromCollectedData } from "../../conversations/voice-conversation-state.codec";
import { reduceVoiceTurnPlanner } from "../intake/voice-turn-planner.reducer";
import {
  STEP_PRIORITY,
  type VoiceTurnStepDescriptor,
} from "../voice-turn-step.descriptor";

export const TRIAGE_HANDOFF_STEP_DESCRIPTORS: VoiceTurnStepDescriptor[] = [
  // Step 8 — TurnPlan: reduce planner and derive urgency/emergency flags
  {
    priority: STEP_PRIORITY.TURN_PLAN,
    build: (_r, deps) => ({
      execute: (ctx) => {
        const {
          normalizedSpeech,
          expectedField,
          nameReady,
          addressReady,
          collectedData,
          existingIssueCandidate,
          hasIssueCandidate,
          issueCandidate,
        } = ctx;
        const urgencyConfirmation =
          getVoiceUrgencyConfirmationFromCollectedData(collectedData);
        const emergencyIssueContext =
          existingIssueCandidate?.value ??
          (hasIssueCandidate ? issueCandidate : "");
        const emergencyRelevant =
          deps.voiceTurnPolicyService.isComfortRiskRelevant(
            existingIssueCandidate?.value ??
              (hasIssueCandidate ? issueCandidate! : ""),
          );
        const isQuestionUtterance =
          deps.voiceUtteranceService.isLikelyQuestion(normalizedSpeech!);
        const turnPlan = reduceVoiceTurnPlanner(
          {
            expectedField: expectedField as Parameters<
              typeof reduceVoiceTurnPlanner
            >[0]["expectedField"],
            nameReady: nameReady!,
            addressReady: addressReady!,
            issueCaptured: Boolean(
              existingIssueCandidate?.value || hasIssueCandidate,
            ),
            emergencyRelevant,
            emergencyAsked: Boolean(urgencyConfirmation.askedAt),
            emergencyAnswered: Boolean(urgencyConfirmation.response),
          },
          { isQuestion: isQuestionUtterance },
        );
        const shouldAskUrgencyConfirm = turnPlan.type === "ASK_EMERGENCY";

        return Promise.resolve({
          kind: "continue",
          ctx: {
            ...ctx,
            urgencyConfirmation,
            emergencyIssueContext: emergencyIssueContext ?? "",
            emergencyRelevant,
            isQuestionUtterance,
            turnPlan,
            shouldAskUrgencyConfirm,
          },
        } as const);
      },
    }),
  },

  // Step 9 — Interrupt: handle hangup, human-transfer, and SMS-different-number requests
  {
    priority: STEP_PRIORITY.INTERRUPT,
    build: (r) => ({
      execute: async (ctx) => {
        const result = await r.turnInterruptRuntime.handleInterrupts({
          res: ctx.res,
          tenantId: ctx.tenant.id,
          conversationId: ctx.conversationId!,
          callSid: ctx.callSid,
          currentEventId: ctx.currentEventId!,
          normalizedSpeech: ctx.normalizedSpeech!,
          strategy: ctx.csrStrategy,
          phoneState: ctx.phoneState!,
        });
        if (result.kind === "exit")
          return { kind: "exit", value: result.value };
        return { kind: "continue", ctx };
      },
    }),
  },

  // Step 10 — SideQuestion: answer fee/availability side-questions mid-intake
  {
    priority: STEP_PRIORITY.SIDE_QUESTION,
    build: (r) => ({
      execute: async (ctx) => {
        const result = await r.turnSideQuestionRuntime.handle({
          res: ctx.res,
          tenantId: ctx.tenant.id,
          conversationId: ctx.conversationId!,
          callSid: ctx.callSid,
          displayName: ctx.displayName!,
          normalizedSpeech: ctx.normalizedSpeech!,
          expectedField: ctx.expectedField!,
          nameReady: ctx.nameReady!,
          addressReady: ctx.addressReady!,
          nameState: ctx.nameState!,
          addressState: ctx.addressState!,
          collectedData: ctx.collectedData ?? null,
          currentEventId: ctx.currentEventId!,
          strategy: ctx.csrStrategy,
          timingCollector: ctx.timingCollector,
          shouldAskUrgencyConfirm: ctx.shouldAskUrgencyConfirm!,
          urgencyConfirmation: ctx.urgencyConfirmation!,
          emergencyIssueContext: ctx.emergencyIssueContext!,
        });
        if (result.kind === "exit")
          return { kind: "exit", value: result.value };
        return { kind: "continue", ctx };
      },
    }),
  },

  // Step 16 — AiTriage: terminal step — always exits with the AI triage response
  {
    priority: STEP_PRIORITY.AI_TRIAGE,
    build: (r) => ({
      execute: async (ctx) => {
        const result = await r.turnAiTriageRuntime.handle({
          res: ctx.res,
          tenantId: ctx.tenant.id,
          conversationId: ctx.conversationId!,
          callSid: ctx.callSid,
          displayName: ctx.displayName!,
          normalizedSpeech: ctx.normalizedSpeech!,
          currentEventId: ctx.currentEventId!,
          nameReady: ctx.nameReady!,
          addressReady: ctx.addressReady!,
          nameState: ctx.nameState!,
          addressState: ctx.addressState!,
          collectedData: ctx.collectedData ?? null,
          strategy: ctx.csrStrategy,
          timingCollector: ctx.timingCollector,
          shouldPromptForIssue: ctx.turnPlan?.type === "ASK_ISSUE",
        });
        return { kind: "exit", value: result };
      },
    }),
  },
];
