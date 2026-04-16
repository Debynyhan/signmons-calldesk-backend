import * as voiceAddressCandidatePolicy from "../intake/voice-address-candidate.policy";
import {
  STEP_PRIORITY,
  type VoiceTurnStepDescriptor,
} from "../voice-turn-step.descriptor";

export const ADDRESS_STEP_DESCRIPTORS: VoiceTurnStepDescriptor[] = [
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
];
