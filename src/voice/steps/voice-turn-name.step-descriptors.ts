import {
  extractNameCandidateDeterministic,
  isLikelyNameCandidate,
  isValidNameCandidate,
} from "../intake/voice-name-candidate.policy";
import { LOGGER_CONTEXT } from "../voice-turn-runtime.types";
import {
  STEP_PRIORITY,
  type VoiceTurnStepDescriptor,
} from "../voice-turn-step.descriptor";

export const NAME_STEP_DESCRIPTORS: VoiceTurnStepDescriptor[] = [
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
          await deps.voiceTurnOrchestration.updateVoiceIssueCandidate({
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
              await deps.voiceNameSlot.updateVoiceNameState({
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
];
