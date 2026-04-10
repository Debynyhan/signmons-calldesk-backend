import type { ConversationsService } from "../conversations/conversations.service";
import type { SpelledNameParts } from "./intake/voice-name-candidate.policy";
import {
  clearNameSpellPrompt,
  markNameSpellPrompted as reduceMarkNameSpellPrompted,
} from "./intake/voice-name-slot.reducer";

type VoiceNameState = ReturnType<ConversationsService["getVoiceNameState"]>;

type StoreProvisionalNameOptions = {
  lastConfidence?: number | null;
  corrections?: number;
  firstNameSpelled?: string | null;
  spellPromptedAt?: number | null;
  spellPromptedTurnIndex?: number | null;
  spellPromptCount?: number;
};

type VoiceTurnNameSpellingPolicy = {
  parseSpelledNameParts: (transcript: string) => SpelledNameParts;
  extractNameCandidateDeterministic: (transcript: string) => string | null;
  normalizeNameCandidate: (value: string) => string;
  isValidNameCandidate: (value: string) => boolean;
  isLikelyNameCandidate: (value: string) => boolean;
  updateVoiceNameState: (params: {
    tenantId: string;
    conversationId: string;
    nameState: VoiceNameState;
  }) => Promise<unknown>;
  log: (payload: Record<string, unknown>) => void;
};

export class VoiceTurnNameSpellingRuntime {
  constructor(private readonly policy: VoiceTurnNameSpellingPolicy) {}

  async handle(params: {
    normalizedSpeech: string;
    nameState: VoiceNameState;
    confidence: number | null | undefined;
    turnIndex: number;
    tenantId: string;
    conversationId: string;
    callSid: string;
    storeProvisionalName: (
      candidate: string,
      options?: StoreProvisionalNameOptions,
    ) => Promise<VoiceNameState>;
    acknowledgeNameAndMoveOn: (candidate: string) => Promise<string>;
    replyWithNameTwiml: (twiml: string) => Promise<string>;
    replyWithAddressPrompt: () => Promise<string>;
    buildSpellNameTwiml: () => string;
  }): Promise<string | null> {
    const spellingResponseCandidate = this.policy.normalizeNameCandidate(
      params.normalizedSpeech,
    );
    const shouldHandleSpellingResponse =
      Boolean(params.nameState.spellPromptedAt) &&
      (typeof params.nameState.spellPromptedTurnIndex !== "number" ||
        params.turnIndex > params.nameState.spellPromptedTurnIndex ||
        (spellingResponseCandidate &&
          this.policy.isValidNameCandidate(spellingResponseCandidate) &&
          this.policy.isLikelyNameCandidate(spellingResponseCandidate)));

    if (!shouldHandleSpellingResponse) {
      return null;
    }

    const parsed = this.policy.parseSpelledNameParts(params.normalizedSpeech);
    if (parsed.firstName) {
      const candidate = parsed.lastName
        ? `${parsed.firstName} ${parsed.lastName}`
        : parsed.firstName;
      await params.storeProvisionalName(candidate, {
        lastConfidence: 0.95,
        corrections: params.nameState.corrections ?? 0,
        firstNameSpelled: parsed.firstName,
        spellPromptedAt: null,
        spellPromptedTurnIndex: null,
        spellPromptCount: params.nameState.spellPromptCount ?? 1,
      });
      this.policy.log({
        event: "nameCapture.spellParsed",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        parsed: parsed.firstName,
        letterCount: parsed.letterCount,
        turnIndex: params.turnIndex,
      });
      return params.acknowledgeNameAndMoveOn(candidate);
    }

    if (parsed.reason === "no_letters") {
      const fallbackCandidate =
        this.policy.extractNameCandidateDeterministic(params.normalizedSpeech) ??
        this.policy.normalizeNameCandidate(params.normalizedSpeech);
      if (
        fallbackCandidate &&
        this.policy.isValidNameCandidate(fallbackCandidate) &&
        this.policy.isLikelyNameCandidate(fallbackCandidate)
      ) {
        await params.storeProvisionalName(fallbackCandidate, {
          lastConfidence: params.confidence ?? null,
          corrections: params.nameState.corrections ?? 0,
          spellPromptedAt: null,
          spellPromptedTurnIndex: null,
          spellPromptCount: params.nameState.spellPromptCount ?? 1,
        });
        return params.acknowledgeNameAndMoveOn(fallbackCandidate);
      }
    }

    this.policy.log({
      event: "nameCapture.spellParseFailed",
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      callSid: params.callSid,
      reason: parsed.reason ?? "unknown",
      letterCount: parsed.letterCount,
      turnIndex: params.turnIndex,
    });

    const promptCount = params.nameState.spellPromptCount ?? 0;
    if (promptCount < 2) {
      const promptState = reduceMarkNameSpellPrompted({
        state: params.nameState,
        turnIndex: params.turnIndex,
        nowMs: Date.now(),
      });
      await this.policy.updateVoiceNameState({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        nameState: promptState,
      });
      this.policy.log({
        event: "nameCapture.spellPrompted",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        candidate: params.nameState.candidate.value ?? null,
        lastConfidence: params.nameState.lastConfidence ?? null,
        corrections: params.nameState.corrections ?? 0,
        turnIndex: params.turnIndex,
      });
      return params.replyWithNameTwiml(params.buildSpellNameTwiml());
    }

    await this.policy.updateVoiceNameState({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      nameState: clearNameSpellPrompt(params.nameState),
    });
    return params.replyWithAddressPrompt();
  }
}
