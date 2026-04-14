import { VoiceTurnRuntimeFactory } from "../voice-turn-runtime.factory";
import type { AppConfig } from "../../config/app.config";
import { VoiceTurnPreludeRuntime } from "../voice-turn-prelude.runtime";
import { VoiceTurnContextRuntime } from "../voice-turn-context.runtime";
import { VoiceTurnEarlyRoutingRuntime } from "../voice-turn-early-routing.runtime";
import { VoiceTurnExpectedFieldRuntime } from "../voice-turn-expected-field.runtime";
import { VoiceTurnIssueRecoveryRuntime } from "../voice-turn-issue-recovery.runtime";
import { VoiceTurnInterruptRuntime } from "../voice-turn-interrupt.runtime";
import { VoiceTurnAiTriageRuntime } from "../voice-turn-ai-triage.runtime";
import { VoiceTurnNameOpeningRuntime } from "../voice-turn-name-opening.runtime";
import { VoiceTurnNameCaptureRuntime } from "../voice-turn-name-capture.runtime";
import { VoiceTurnNameFlowRuntime } from "../voice-turn-name-flow.runtime";
import { VoiceTurnNameSpellingRuntime } from "../voice-turn-name-spelling.runtime";
import { VoiceTurnAddressExtractionRuntime } from "../voice-turn-address-extraction.runtime";
import { VoiceTurnAddressRoutingRuntime } from "../voice-turn-address-routing.runtime";
import { VoiceTurnAddressCompletenessRuntime } from "../voice-turn-address-completeness.runtime";
import { VoiceTurnAddressExistingCandidateRuntime } from "../voice-turn-address-existing-candidate.runtime";
import { VoiceTurnAddressConfirmedRuntime } from "../voice-turn-address-confirmed.runtime";
import { VoiceTurnSideQuestionHelperRuntime } from "../voice-turn-side-question-helper.runtime";
import { VoiceTurnSideQuestionRoutingRuntime } from "../voice-turn-side-question-routing.runtime";
import { VoiceTurnSideQuestionRuntime } from "../voice-turn-side-question.runtime";
import { VoiceTurnHandoffRuntime } from "../voice-turn-handoff.runtime";
import { VoiceTurnPreludeContextFactory } from "../voice-turn-prelude-context.factory";
import { VoiceTurnNameFlowFactory } from "../voice-turn-name-flow.factory";
import { VoiceTurnAddressFlowFactory } from "../voice-turn-address-flow.factory";
import { VoiceTurnTriageHandoffFactory } from "../voice-turn-triage-handoff.factory";
import { VoiceTurnStepFactory } from "../voice-turn-step.factory";

const buildConfig = (): AppConfig =>
  ({
    voiceAddressMinConfidence: 0.7,
    voiceSoftConfirmMinConfidence: 0.85,
  }) as AppConfig;

const buildDeps = () =>
  ({
    conversationsService: {
      getVoiceConversationByCallSid: jest.fn(),
    },
    callLogService: {},
    csrStrategySelector: { selectStrategy: jest.fn() },
    voiceSmsPhoneSlotService: { handleExpectedField: jest.fn() },
    voiceUrgencySlotService: { handleExpectedField: jest.fn() },
    voiceIntakeSmsService: { sendVoiceHandoffIntakeLink: jest.fn() },
    voiceTranscriptState: {
      updateVoiceTranscript: jest.fn(),
    },
    voiceNameSlot: {
      updateVoiceNameState: jest.fn(),
      promoteNameFromSms: jest.fn(),
    },
    voiceAddressSlot: {
      updateVoiceAddressState: jest.fn(),
      promoteAddressFromSms: jest.fn(),
    },
    voiceSmsSlot: {
      updateVoiceSmsHandoff: jest.fn(),
      updateVoiceSmsPhoneState: jest.fn(),
      clearVoiceSmsHandoff: jest.fn(),
    },
    voiceTurnOrchestration: {
      incrementVoiceTurn: jest.fn(),
      updateVoiceIssueCandidate: jest.fn(),
      updateVoiceComfortRisk: jest.fn(),
      updateVoiceUrgencyConfirmation: jest.fn(),
      updateVoiceListeningWindow: jest.fn(),
      clearVoiceListeningWindow: jest.fn(),
      updateVoiceLastEventId: jest.fn(),
      appendVoiceTurnTiming: jest.fn(),
    },
    aiService: {
      extractNameCandidate: jest.fn(),
      extractAddressCandidate: jest.fn(),
      triage: jest.fn(),
    },
    loggingService: { log: jest.fn(), warn: jest.fn() },
    sanitizationService: {
      normalizePhoneE164: jest.fn(),
      normalizeWhitespace: jest.fn(),
    },
    voicePromptComposer: {
      buildRepromptTwiml: jest.fn(),
      buildSayGatherTwiml: jest.fn(),
      buildTwiml: jest.fn(),
      buildBookingPromptTwiml: jest.fn(),
      buildCallbackOfferTwiml: jest.fn(),
      buildAskNameTwiml: jest.fn(),
      buildAskSmsNumberTwiml: jest.fn(),
      buildAddressLocalityPromptTwiml: jest.fn(),
      buildAddressConfirmationTwiml: jest.fn(),
      buildAddressSoftConfirmationTwiml: jest.fn(),
      buildYesNoRepromptTwiml: jest.fn(),
      buildTakeYourTimeTwiml: jest.fn(),
      buildClosingTwiml: jest.fn(),
      buildUrgencyConfirmTwiml: jest.fn(),
      applyCsrStrategy: jest.fn(),
      prependPrefaceToGatherTwiml: jest.fn(),
    },
    voiceHandoffPolicy: {
      getTenantFeePolicySafe: jest.fn(),
      getTenantFeeConfig: jest.fn(),
      formatFeeAmount: jest.fn(),
      getTenantDisplayNameSafe: jest.fn(),
    },
    voiceSmsHandoffService: {
      prepare: jest.fn(),
      buildSmsHandoffMessage: jest.fn(),
      buildSmsHandoffMessageForContext: jest.fn(),
      resolveSmsHandoffClosingMessage: jest.fn(),
    },
    voiceTurnPolicyService: {
      normalizeConfidence: jest.fn(),
      getTenantDisplayName: jest.fn(),
      isLikelyIssueCandidate: jest.fn(),
      normalizeIssueCandidate: jest.fn(),
      buildIssueAcknowledgement: jest.fn(),
      isVoiceFieldReady: jest.fn(),
      isOpeningGreetingOnly: jest.fn(),
      getVoiceIssueCandidate: jest.fn(),
      isLikelyAddressInputForName: jest.fn(),
      isSoftConfirmationEligible: jest.fn(),
      shouldDiscloseFees: jest.fn(),
      isUrgencyEmergency: jest.fn(),
      getVoiceNameCandidate: jest.fn(),
      isPaymentRequiredNext: jest.fn(),
      isIssueRepeatComplaint: jest.fn(),
      buildFallbackIssueCandidate: jest.fn(),
    },
    voiceUtteranceService: {
      isSlowDownRequest: jest.fn(),
      isFrustrationRequest: jest.fn(),
      isHumanTransferRequest: jest.fn(),
      isSmsDifferentNumberRequest: jest.fn(),
      isHangupRequest: jest.fn(),
      resolveBinaryUtterance: jest.fn(),
      isLikelyQuestion: jest.fn(),
      isBookingIntent: jest.fn(),
      isDuplicateTranscript: jest.fn(),
    },
    voiceAddressPromptService: { buildAddressPromptForState: jest.fn() },
    voiceResponseService: {
      replyWithTwiml: jest.fn(),
      replyWithNoHandoff: jest.fn(),
      replyWithHumanFallback: jest.fn(),
      getIssuePromptAttempts: jest.fn(),
      setIssuePromptAttempts: jest.fn(),
      clearIssuePromptAttempts: jest.fn(),
    },
    voiceListeningWindowService: {
      getVoiceListeningWindow: jest.fn(),
      getVoiceLastEventId: jest.fn(),
      isListeningWindowExpired: jest.fn(),
      getExpectedListeningField: jest.fn(),
      shouldClearListeningWindow: jest.fn(),
      buildListeningWindowReprompt: jest.fn(),
      replyWithListeningWindow: jest.fn(),
      clearVoiceListeningWindow: jest.fn(),
    },
  }) as never;

describe("VoiceTurnRuntimeFactory", () => {
  const buildFactory = () => {
    const config = buildConfig();
    const deps = buildDeps();
    return new VoiceTurnRuntimeFactory(
      new VoiceTurnTriageHandoffFactory(deps, deps.voiceIntakeSmsService),
      new VoiceTurnPreludeContextFactory(
        config,
        deps,
        deps.conversationsService,
        deps.callLogService,
        deps.csrStrategySelector,
        deps.voiceSmsPhoneSlotService,
        deps.voiceUrgencySlotService,
      ),
      new VoiceTurnNameFlowFactory(deps),
      new VoiceTurnAddressFlowFactory(config, deps),
      new VoiceTurnStepFactory(deps),
    );
  };

  it("build() returns all 20 runtimes as proper class instances", () => {
    const factory = buildFactory();
    const r = factory.build();

    expect(r.turnPreludeRuntime).toBeInstanceOf(VoiceTurnPreludeRuntime);
    expect(r.turnContextRuntime).toBeInstanceOf(VoiceTurnContextRuntime);
    expect(r.turnEarlyRoutingRuntime).toBeInstanceOf(
      VoiceTurnEarlyRoutingRuntime,
    );
    expect(r.turnExpectedFieldRuntime).toBeInstanceOf(
      VoiceTurnExpectedFieldRuntime,
    );
    expect(r.turnIssueRecoveryRuntime).toBeInstanceOf(
      VoiceTurnIssueRecoveryRuntime,
    );
    expect(r.turnInterruptRuntime).toBeInstanceOf(VoiceTurnInterruptRuntime);
    expect(r.turnAiTriageRuntime).toBeInstanceOf(VoiceTurnAiTriageRuntime);
    expect(r.turnNameOpeningRuntime).toBeInstanceOf(
      VoiceTurnNameOpeningRuntime,
    );
    expect(r.turnNameCaptureRuntime).toBeInstanceOf(
      VoiceTurnNameCaptureRuntime,
    );
    expect(r.turnNameFlowRuntime).toBeInstanceOf(VoiceTurnNameFlowRuntime);
    expect(r.turnNameSpellingRuntime).toBeInstanceOf(
      VoiceTurnNameSpellingRuntime,
    );
    expect(r.turnAddressExtractionRuntime).toBeInstanceOf(
      VoiceTurnAddressExtractionRuntime,
    );
    expect(r.turnAddressRoutingRuntime).toBeInstanceOf(
      VoiceTurnAddressRoutingRuntime,
    );
    expect(r.turnAddressCompletenessRuntime).toBeInstanceOf(
      VoiceTurnAddressCompletenessRuntime,
    );
    expect(r.turnAddressExistingCandidateRuntime).toBeInstanceOf(
      VoiceTurnAddressExistingCandidateRuntime,
    );
    expect(r.turnAddressConfirmedRuntime).toBeInstanceOf(
      VoiceTurnAddressConfirmedRuntime,
    );
    expect(r.turnSideQuestionHelperRuntime).toBeInstanceOf(
      VoiceTurnSideQuestionHelperRuntime,
    );
    expect(r.turnSideQuestionRoutingRuntime).toBeInstanceOf(
      VoiceTurnSideQuestionRoutingRuntime,
    );
    expect(r.turnSideQuestionRuntime).toBeInstanceOf(
      VoiceTurnSideQuestionRuntime,
    );
    expect(r.turnHandoffRuntime).toBeInstanceOf(VoiceTurnHandoffRuntime);
  });

  it("build() called twice returns independent runtime instances", () => {
    const factory = buildFactory();
    const r1 = factory.build();
    const r2 = factory.build();
    expect(r1.turnPreludeRuntime).not.toBe(r2.turnPreludeRuntime);
    expect(r1.turnHandoffRuntime).not.toBe(r2.turnHandoffRuntime);
  });
});
