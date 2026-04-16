import { ADDRESS_STEP_DESCRIPTORS } from "./steps/voice-turn-address.step-descriptors";
import { NAME_STEP_DESCRIPTORS } from "./steps/voice-turn-name.step-descriptors";
import { PRELUDE_CONTEXT_STEP_DESCRIPTORS } from "./steps/voice-turn-prelude-context.step-descriptors";
import { TRIAGE_HANDOFF_STEP_DESCRIPTORS } from "./steps/voice-turn-triage-handoff.step-descriptors";
import type { VoiceTurnStepDescriptor } from "./voice-turn-step.descriptor";

export const VOICE_TURN_STEP_REGISTRATIONS = "VOICE_TURN_STEP_REGISTRATIONS";

export const DEFAULT_VOICE_TURN_STEP_DESCRIPTORS: VoiceTurnStepDescriptor[] = [
  ...PRELUDE_CONTEXT_STEP_DESCRIPTORS,
  ...NAME_STEP_DESCRIPTORS,
  ...ADDRESS_STEP_DESCRIPTORS,
  ...TRIAGE_HANDOFF_STEP_DESCRIPTORS,
];

export { STEP_PRIORITY } from "./voice-turn-step.descriptor";
export type { VoiceTurnStepDescriptor } from "./voice-turn-step.descriptor";
