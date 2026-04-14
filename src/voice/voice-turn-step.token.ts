import * as voiceAddressCandidatePolicy from "./intake/voice-address-candidate.policy";
import {
  extractNameCandidateDeterministic,
  isLikelyNameCandidate,
  isValidNameCandidate,
} from "./intake/voice-name-candidate.policy";
import { reduceVoiceTurnPlanner } from "./intake/voice-turn-planner.reducer";
import { setRequestContextData } from "../common/context/request-context";
import type { IVoiceTurnStep } from "./voice-turn.step.interface";
import type { VoiceTurnRuntimeSet } from "./voice-turn-runtime.types";
import { LOGGER_CONTEXT } from "./voice-turn-runtime.types";
import type { VoiceTurnDependencies } from "./voice-turn.dependencies";

export const VOICE_TURN_STEP_REGISTRATIONS = "VOICE_TURN_STEP_REGISTRATIONS";

export type VoiceTurnStepDescriptor = {
  priority: number;
  build(r: VoiceTurnRuntimeSet, deps: VoiceTurnDependencies): IVoiceTurnStep;
};

export const STEP_PRIORITY = {
  PRELUDE: 100,
  REQUEST_CONTEXT: 200,
  CONTEXT: 300,
  EARLY_ROUTING: 400,
  SLOW_DOWN: 500,
  ISSUE_CANDIDATE: 600,
  ADDRESS_FIELD_HEURISTIC: 700,
  TURN_PLAN: 800,
  INTERRUPT: 900,
  SIDE_QUESTION: 1000,
  NAME_FLOW: 1100,
  EXPECTED_FIELD: 1200,
  ADDRESS_WINDOW_CLEAR: 1300,
  ADDRESS_NOT_READY: 1400,
  ADDRESS_CONFIRMED_CONTINUATION: 1500,
  AI_TRIAGE: 1600,
} as const;

export const DEFAULT_VOICE_TURN_STEP_DESCRIPTORS: VoiceTurnStepDescriptor[] = [
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

  // Step 6 — IssueCandidate: capture issue slot and optional multi-slot name
  {
    priority: STEP_PRIORITY.ISSUE_CANDIDATE,
    build: (_r, deps) => ({
      execute: async (ctx) => {
        const {
          tenant,
          callSid,
          conversationId,
          currentEventId,
          normalizedSpeech,
          confidence,
          collectedData,
        } = ctx;
        let nameState = ctx.nameState!;
        let nameReady = ctx.nameReady!;
        const expectedField = ctx.expectedField;

        const existingIssueCandidate =
          deps.voiceTurnPolicyService.getVoiceIssueCandidate(collectedData);
        const issueCandidate =
          deps.voiceTurnPolicyService.normalizeIssueCandidate(normalizedSpeech!);
        const hasIssueCandidate =
          deps.voiceTurnPolicyService.isLikelyIssueCandidate(issueCandidate);
        let openingAddressPreface: string | null = null;

        if (existingIssueCandidate?.value || hasIssueCandidate) {
          deps.voiceResponseService.clearIssuePromptAttempts(callSid);
        }
        if (hasIssueCandidate && !existingIssueCandidate?.value) {
          await deps.voiceConversationStateService.updateVoiceIssueCandidate({
            tenantId: tenant.id,
            conversationId: conversationId!,
            issue: {
              value: issueCandidate,
              sourceEventId: currentEventId ?? "",
              createdAt: new Date().toISOString(),
            },
          });
        }

        const shouldCaptureOpeningNameFromMultiSlot =
          !expectedField &&
          !nameReady &&
          hasIssueCandidate &&
          nameState.status === "MISSING" &&
          nameState.attemptCount === 0 &&
          !nameState.candidate.value;

        if (shouldCaptureOpeningNameFromMultiSlot) {
          const deterministicNameCandidate = extractNameCandidateDeterministic(
            normalizedSpeech!,
            deps.sanitizationService,
          );
          const hasDeterministicName =
            deterministicNameCandidate &&
            isValidNameCandidate(deterministicNameCandidate) &&
            isLikelyNameCandidate(deterministicNameCandidate);
          if (hasDeterministicName && deterministicNameCandidate) {
            const currentName = nameState.candidate.value?.trim().toLowerCase() ?? "";
            const incomingName = deterministicNameCandidate.trim().toLowerCase();
            if (currentName !== incomingName || !nameState.locked) {
              const nextNameState: typeof nameState = {
                ...nameState,
                candidate: {
                  value: deterministicNameCandidate,
                  sourceEventId: currentEventId ?? null,
                  createdAt: new Date().toISOString(),
                },
                status: "CANDIDATE",
                locked: true,
                attemptCount: Math.max(1, nameState.attemptCount),
                lastConfidence:
                  typeof confidence === "number"
                    ? confidence
                    : (nameState.lastConfidence ?? null),
                spellPromptedAt: null,
                spellPromptedTurnIndex: null,
              };
              await deps.voiceConversationStateService.updateVoiceNameState({
                tenantId: tenant.id,
                conversationId: conversationId!,
                nameState: nextNameState,
              });
              deps.loggingService.log(
                {
                  event: "voice.name_multislot_captured",
                  tenantId: tenant.id,
                  conversationId: conversationId!,
                  callSid,
                  candidate: deterministicNameCandidate,
                  sourceEventId: currentEventId,
                },
                LOGGER_CONTEXT,
              );
              nameState = nextNameState;
            }
            nameReady = true;
            const msFirstName =
              deterministicNameCandidate.split(" ").filter(Boolean)[0] ?? "";
            const msIssueAck = hasIssueCandidate
              ? deps.voiceTurnPolicyService.buildIssueAcknowledgement(issueCandidate)
              : null;
            const msTrimmedIssue =
              msIssueAck?.trim().replace(/[.?!]+$/, "") ?? "";
            openingAddressPreface = msFirstName
              ? msTrimmedIssue
                ? `Thanks, ${msFirstName}. I heard ${msTrimmedIssue}.`
                : `Thanks, ${msFirstName}.`
              : null;
          }
        }

        return {
          kind: "continue",
          ctx: {
            ...ctx,
            nameState,
            nameReady,
            existingIssueCandidate,
            issueCandidate,
            hasIssueCandidate,
            openingAddressPreface,
          },
        };
      },
    }),
  },

  // Step 7 — AddressFieldHeuristic: detect address signals that override expectedField
  {
    priority: STEP_PRIORITY.ADDRESS_FIELD_HEURISTIC,
    build: (_r, deps) => ({
      execute: (ctx) => {
        const { normalizedSpeech, nameReady, addressReady, addressState } = ctx;
        let expectedField = ctx.expectedField;

        if (
          !nameReady &&
          !expectedField &&
          deps.voiceTurnPolicyService.isLikelyAddressInputForName(normalizedSpeech!)
        ) {
          expectedField = "address";
        }
        const yesNoIntent = deps.voiceUtteranceService.resolveBinaryUtterance(
          normalizedSpeech!,
        );
        if (
          !expectedField &&
          !addressReady &&
          Boolean(addressState!.candidate) &&
          (Boolean(yesNoIntent) ||
            /\d/.test(normalizedSpeech!) ||
            Boolean(
              voiceAddressCandidatePolicy.extractAddressLocalityCorrection(
                normalizedSpeech!,
                deps.sanitizationService,
              ),
            ))
        ) {
          expectedField = "address";
        }

        return Promise.resolve({
          kind: "continue",
          ctx: { ...ctx, expectedField, yesNoIntent },
        } as const);
      },
    }),
  },

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
          deps.conversationsService.getVoiceUrgencyConfirmation(collectedData);
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

  // Step 11 — NameFlow: capture/confirm caller name; exits when name flow is active
  {
    priority: STEP_PRIORITY.NAME_FLOW,
    build: (r, deps) => ({
      execute: async (ctx) => {
        const { nameReady, expectedField } = ctx;
        if (nameReady || (expectedField && expectedField !== "name")) {
          return { kind: "continue", ctx };
        }
        const {
          tenant,
          callSid,
          conversationId,
          currentEventId,
          normalizedSpeech,
          confidence,
          nameState,
          csrStrategy,
          voiceTurnCount,
          collectedData,
          existingIssueCandidate,
          timingCollector,
        } = ctx;
        const existingIssueSummary = existingIssueCandidate?.value
          ? deps.voiceTurnPolicyService.buildIssueAcknowledgement(
              existingIssueCandidate.value,
            )
          : null;
        const bookingIntent = deps.voiceUtteranceService.isBookingIntent(
          normalizedSpeech!,
        );
        const isOpeningTurn =
          !expectedField &&
          nameState!.status === "MISSING" &&
          nameState!.attemptCount === 0 &&
          !nameState!.candidate.value &&
          !existingIssueCandidate?.value;

        const nameFlowSession = r.turnNameFlowRuntime.createSession({
          res: ctx.res,
          tenantId: tenant.id,
          conversationId: conversationId!,
          callSid,
          currentEventId: currentEventId!,
          strategy: csrStrategy,
          turnIndex: voiceTurnCount!,
          nameState: nameState!,
          existingIssueSummary,
          buildSpellNameTwiml: () =>
            deps.voicePromptComposer.buildSpellNameTwiml(csrStrategy),
        });

        const spellingResponse = await r.turnNameSpellingRuntime.handle({
          normalizedSpeech: normalizedSpeech!,
          nameState: nameFlowSession.getNameState(),
          confidence,
          turnIndex: voiceTurnCount!,
          tenantId: tenant.id,
          conversationId: conversationId!,
          callSid,
          storeProvisionalName: nameFlowSession.storeProvisionalName,
          acknowledgeNameAndMoveOn: nameFlowSession.acknowledgeNameAndMoveOn,
          replyWithNameTwiml: nameFlowSession.replyWithNameTwiml,
          replyWithAddressPrompt: () => nameFlowSession.replyWithAddressPrompt(),
          buildSpellNameTwiml: () =>
            deps.voicePromptComposer.buildSpellNameTwiml(csrStrategy),
        });
        if (spellingResponse) {
          return { kind: "exit", value: spellingResponse };
        }

        const openingTurnReply = await r.turnNameOpeningRuntime.handle({
          isOpeningTurn,
          res: ctx.res,
          tenantId: tenant.id,
          conversationId: conversationId!,
          callSid,
          currentEventId: currentEventId!,
          normalizedSpeech: normalizedSpeech!,
          bookingIntent,
          nameState: nameState!,
          confidence,
          strategy: csrStrategy,
          storeProvisionalName: nameFlowSession.storeProvisionalName,
          maybePromptForSpelling: nameFlowSession.maybePromptForSpelling,
          replyWithNameTwiml: nameFlowSession.replyWithNameTwiml,
        });
        if (openingTurnReply) {
          return { kind: "exit", value: openingTurnReply };
        }

        const nameCaptureResult = await r.turnNameCaptureRuntime.handle({
          res: ctx.res,
          tenantId: tenant.id,
          conversationId: conversationId!,
          callSid,
          currentEventId: currentEventId!,
          normalizedSpeech: normalizedSpeech!,
          expectedField: expectedField!,
          bookingIntent,
          nameState: nameState!,
          collectedData,
          confidence,
          strategy: csrStrategy,
          timingCollector,
          recordNameAttemptIfNeeded: nameFlowSession.recordNameAttemptIfNeeded,
          replyWithAddressPrompt: nameFlowSession.replyWithAddressPrompt,
          replyWithNameTwiml: nameFlowSession.replyWithNameTwiml,
          storeProvisionalName: nameFlowSession.storeProvisionalName,
          promptForNameSpelling: nameFlowSession.promptForNameSpelling,
          maybePromptForSpelling: nameFlowSession.maybePromptForSpelling,
          acknowledgeNameAndMoveOn: nameFlowSession.acknowledgeNameAndMoveOn,
        });
        return { kind: "exit", value: nameCaptureResult };
      },
    }),
  },

  // Step 12 — ExpectedField: handle sms_phone expected-field window
  {
    priority: STEP_PRIORITY.EXPECTED_FIELD,
    build: (r) => ({
      execute: async (ctx) => {
        const result =
          await r.turnExpectedFieldRuntime.handleSmsPhoneExpectedField({
            res: ctx.res,
            tenantId: ctx.tenant.id,
            conversationId: ctx.conversationId!,
            callSid: ctx.callSid,
            displayName: ctx.displayName!,
            expectedField: ctx.expectedField!,
            phoneState: ctx.phoneState!,
            collectedData: ctx.collectedData ?? null,
            normalizedSpeech: ctx.normalizedSpeech!,
            currentEventId: ctx.currentEventId!,
            strategy: ctx.csrStrategy,
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

  // Step 13 — AddressWindowClear: dismiss address listening window once address is ready
  {
    priority: STEP_PRIORITY.ADDRESS_WINDOW_CLEAR,
    build: (_r, deps) => ({
      execute: async (ctx) => {
        if (ctx.expectedField === "address" && ctx.addressReady) {
          await deps.voiceListeningWindowService.clearVoiceListeningWindow({
            tenantId: ctx.tenant.id,
            conversationId: ctx.conversationId!,
          });
          return { kind: "continue", ctx: { ...ctx, expectedField: null } };
        }
        return { kind: "continue", ctx };
      },
    }),
  },

  // Step 14 — AddressNotReady: pre-routing and extraction when address not yet captured
  {
    priority: STEP_PRIORITY.ADDRESS_NOT_READY,
    build: (r) => ({
      execute: async (ctx) => {
        const {
          addressReady,
          expectedField,
          tenant,
          conversationId,
          callSid,
          displayName,
          currentEventId,
          normalizedSpeech,
          confidence,
          addressState,
          nameState,
          nameReady,
          collectedData,
          openingAddressPreface,
          csrStrategy,
          timingCollector,
        } = ctx;
        if (addressReady || (expectedField && expectedField !== "address")) {
          return { kind: "continue", ctx };
        }

        const addressPreRoutingResponse =
          await r.turnAddressRoutingRuntime.handleNotReady({
            res: ctx.res,
            tenantId: tenant.id,
            conversationId: conversationId!,
            callSid,
            displayName: displayName!,
            currentEventId: currentEventId!,
            normalizedSpeech: normalizedSpeech!,
            confidence,
            addressState: addressState!,
            nameState: nameState!,
            nameReady: nameReady!,
            collectedData,
            expectedField: expectedField!,
            openingAddressPreface: openingAddressPreface!,
            strategy: csrStrategy,
            timingCollector,
          });
        if (addressPreRoutingResponse) {
          return { kind: "exit", value: addressPreRoutingResponse };
        }

        const extraction = await r.turnAddressExtractionRuntime.handle({
          res: ctx.res,
          tenantId: tenant.id,
          conversationId: conversationId!,
          callSid,
          displayName: displayName!,
          currentEventId: currentEventId!,
          normalizedSpeech: normalizedSpeech!,
          addressState: addressState!,
          nameState: nameState!,
          collectedData,
          strategy: csrStrategy,
          timingCollector,
        });
        return { kind: "exit", value: extraction };
      },
    }),
  },

  // Step 15 — AddressConfirmedContinuation: post-lock continuation on the same event
  {
    priority: STEP_PRIORITY.ADDRESS_CONFIRMED_CONTINUATION,
    build: (r) => ({
      execute: async (ctx) => {
        const {
          addressState,
          currentEventId,
          tenant,
          conversationId,
          callSid,
          displayName,
          nameState,
          nameReady,
          collectedData,
          csrStrategy,
          timingCollector,
        } = ctx;
        if (
          addressState!.locked &&
          addressState!.sourceEventId &&
          addressState!.sourceEventId === currentEventId
        ) {
          const result =
            await r.turnAddressConfirmedRuntime.handleAddressConfirmedContinuation(
              {
                res: ctx.res,
                tenantId: tenant.id,
                conversationId: conversationId!,
                callSid,
                displayName: displayName!,
                currentEventId: currentEventId ?? null,
                addressState: addressState!,
                nameState: nameState!,
                nameReady: nameReady!,
                collectedData: collectedData ?? null,
                strategy: csrStrategy,
                timingCollector,
              },
            );
          return { kind: "exit", value: result };
        }
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
