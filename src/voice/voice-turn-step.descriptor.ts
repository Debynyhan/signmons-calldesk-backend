import type { IVoiceTurnStep } from "./voice-turn.step.interface";
import type { VoiceTurnRuntimeSet } from "./voice-turn-runtime.types";
import type { VoiceTurnDependencies } from "./voice-turn.dependencies";

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
