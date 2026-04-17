# ADR-0002 Voice Turn Runtime Pipeline

## Status
Accepted

## Date
2026-04-17

## Context
The voice turn path previously concentrated orchestration, branching, and side-effect handling in dense services, making regression risk and test setup cost high.

## Decision
- Use ordered turn step descriptors resolved through `VOICE_TURN_STEP_REGISTRATIONS`.
- Execute turn logic through `VoiceTurnPipeline` with explicit continue/exit semantics.
- Decompose orchestration into focused runtime factories and runtime helper builders.
- Keep stream-turn lifecycle logic isolated in dedicated runtimes for execution and forced hangup handling.
- Persist timing telemetry (turn total, AI timing, breach labels) from stream execution.

## Consequences
- Voice orchestration is easier to extend without rewriting central dispatch code.
- Runtime units are smaller and simpler to test independently.
- Latency and lifecycle quality remain observable through persisted timing data.
