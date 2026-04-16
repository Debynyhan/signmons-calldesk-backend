import { setRequestContextData } from "../../common/context/request-context";
import {
  STEP_PRIORITY,
  type VoiceTurnStepDescriptor,
} from "../voice-turn-step.descriptor";

export const PRELUDE_CONTEXT_STEP_DESCRIPTORS: VoiceTurnStepDescriptor[] = [
  // Step 1 — Prelude: normalise speech, load conversation, emit transcript event
  {
    priority: STEP_PRIORITY.PRELUDE,
    build: (r) => ({
      execute: async (ctx) => {
        const prelude = await r.turnPreludeRuntime.prepare({
          res: ctx.res,
          tenant: ctx.tenant,
          callSid: ctx.callSid,
          speechResult: ctx.speechResult,
          confidence: ctx.rawConfidence,
        });
        if (prelude.kind === "exit")
          return { kind: "exit", value: prelude.value };
        return {
          kind: "continue",
          ctx: {
            ...ctx,
            now: prelude.now,
            normalizedSpeech: prelude.normalizedSpeech,
            confidence: prelude.confidence,
            voiceTurnCount: prelude.voiceTurnCount,
            displayName: prelude.displayName,
            currentEventId: prelude.currentEventId,
            conversation: prelude.conversation,
            updatedConversation: prelude.updatedConversation,
            conversationId: prelude.conversationId,
            collectedData: prelude.collectedData,
          },
        };
      },
    }),
  },

  // Step 2 — RequestContext: stamp async-local-storage with turn identifiers
  {
    priority: STEP_PRIORITY.REQUEST_CONTEXT,
    build: () => ({
      execute: (ctx) => {
        setRequestContextData({
          tenantId: ctx.tenant.id,
          requestId: ctx.requestId,
          callSid: ctx.callSid,
          conversationId: ctx.conversationId,
          channel: "VOICE",
          sourceEventId: ctx.currentEventId ?? undefined,
        });
        return Promise.resolve({ kind: "continue", ctx } as const);
      },
    }),
  },

  // Step 3 — Context: load slot states and select CSR strategy
  {
    priority: STEP_PRIORITY.CONTEXT,
    build: (r) => ({
      execute: async (ctx) => {
        const turnContext = await r.turnContextRuntime.prepareTurnContext({
          res: ctx.res,
          tenantId: ctx.tenant.id,
          conversationId: ctx.conversationId!,
          currentEventId: ctx.currentEventId!,
          voiceTurnCount: ctx.voiceTurnCount!,
          now: ctx.now!,
          collectedData: ctx.collectedData ?? null,
          conversationForStrategy: (ctx.updatedConversation ?? ctx.conversation)!,
          conversationCurrentFsmState:
            ctx.updatedConversation?.currentFSMState ??
            ctx.conversation?.currentFSMState ??
            null,
        });
        if (turnContext.kind === "exit")
          return { kind: "exit", value: turnContext.value };
        return {
          kind: "continue",
          ctx: {
            ...ctx,
            nameState: turnContext.nameState,
            phoneState: turnContext.phoneState,
            addressState: turnContext.addressState,
            csrStrategy: turnContext.csrStrategy,
            expectedField: turnContext.expectedField,
            nameReady: turnContext.nameReady,
            addressReady: turnContext.addressReady,
          },
        };
      },
    }),
  },

  // Step 4 — EarlyRouting: booking/callback/comfort-risk/urgency fast-paths
  {
    priority: STEP_PRIORITY.EARLY_ROUTING,
    build: (r) => ({
      execute: async (ctx) => {
        const result = await r.turnEarlyRoutingRuntime.route({
          res: ctx.res,
          tenantId: ctx.tenant.id,
          conversationId: ctx.conversationId!,
          callSid: ctx.callSid,
          displayName: ctx.displayName!,
          currentEventId: ctx.currentEventId!,
          normalizedSpeech: ctx.normalizedSpeech!,
          expectedField: ctx.expectedField!,
          nameReady: ctx.nameReady!,
          addressReady: ctx.addressReady!,
          nameState: ctx.nameState!,
          addressState: ctx.addressState!,
          collectedData: ctx.collectedData ?? null,
          strategy: ctx.csrStrategy,
          timingCollector: ctx.timingCollector,
        });
        if (result.kind === "exit")
          return { kind: "exit", value: result.value };
        return {
          kind: "continue",
          ctx: { ...ctx, expectedField: result.expectedField },
        };
      },
    }),
  },

  // Step 5 — SlowDown: detect pace-request utterances before main routing
  {
    priority: STEP_PRIORITY.SLOW_DOWN,
    build: (r) => ({
      execute: async (ctx) => {
        const result = await r.turnInterruptRuntime.handleSlowDown({
          res: ctx.res,
          tenantId: ctx.tenant.id,
          conversationId: ctx.conversationId!,
          currentEventId: ctx.currentEventId!,
          normalizedSpeech: ctx.normalizedSpeech!,
          expectedField: ctx.expectedField!,
          strategy: ctx.csrStrategy,
        });
        if (result.kind === "exit")
          return { kind: "exit", value: result.value };
        return { kind: "continue", ctx };
      },
    }),
  },
];
