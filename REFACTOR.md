# Voice Module Refactor — SOLID / SoC / SRP

Goal: make the voice module extensible, modular, and easy to test without touching FSM logic.
Each TODO is a standalone PR. Do them in order — later steps depend on earlier seams.

---

## Principles being applied

| Principle | What it means here |
|---|---|
| **SRP** | Each class has one reason to change |
| **OCP** | Adding a runtime/feature should not modify existing services |
| **ISP** | Controller and runtimes only depend on the interface they actually use |
| **DIP** | Depend on abstractions (interfaces), not concrete class internals |
| **SoC** | HTTP layer, business logic, state, and message building are separate concerns |

---

## TODO List

### TODO-1 — Controller → use `VoiceWebhookParserService` for all request parsing
**Principle:** ISP, SRP
**Status:** [x] Done

**Problem:**
`VoiceController` calls `voiceTurnService.extractToNumber()`, `.extractCallSid()`,
`.extractSpeechResult()`, `.extractConfidence()`, `.getRequestId()` — but
`VoiceWebhookParserService` already exists with exactly these methods.
The controller is bypassing it and calling the wrong service.

**Work:**
- Inject `VoiceWebhookParserService` into `VoiceController`
- Replace all `voiceTurnService.extract*` / `getRequestId` calls with `webhookParser.*`
- Remove those methods from `VoiceTurnService` public surface (or mark `@internal`)
- Update controller spec: assert calls go to `webhookParserService`, not `voiceTurnService`

**Files:** `voice.controller.ts`, `voice-webhook-parser.service.ts`, `voice-turn.service.ts`
**Risk:** Low — zero logic changes, pure re-routing

---

### TODO-2 — Extract `VoiceResponseService` (HTTP reply helpers)
**Principle:** SRP, ISP
**Status:** [x] Done

**Problem:**
`replyWithTwiml`, `replyWithNoHandoff`, `replyWithHumanFallback` are on
`VoiceTurnService` — but they are HTTP response concerns, not turn planning concerns.
Multiple runtimes receive them as lambda callbacks, coupling them to the service.

**Work:**
- Create `src/voice/voice-response.service.ts` — `@Injectable()` with the three reply methods
- Update `VoiceTurnDependencies` to include it
- Remove the three methods from `VoiceTurnService`
- Update constructor lambda wiring to call `voiceResponseService.*` directly
- Update `VoiceController` to inject `VoiceResponseService` instead of calling these on turn service
- Add unit tests for `VoiceResponseService`

**Files:** `voice-response.service.ts` (new), `voice-turn.service.ts`, `voice.controller.ts`,
`voice-turn.dependencies.ts`, `voice.module.ts`
**Risk:** Low-medium — touches controller + constructor wiring, but logic is identical

---

### TODO-3 — Extract `VoiceListeningWindowService` (8 listening window methods)
**Principle:** SRP, cohesion
**Status:** [x] Done

**Problem:**
These 8 methods form a tight cohesive group inside `VoiceTurnService` but are not
part of turn planning — they manage the "expected field + window expiry" state:

- `getVoiceListeningWindow`
- `getVoiceLastEventId`
- `isListeningWindowExpired`
- `getExpectedListeningField`
- `shouldClearListeningWindow`
- `buildListeningWindowReprompt`
- `replyWithListeningWindow`
- `clearVoiceListeningWindow`

Six runtimes receive these as lambda callbacks — they should inject the service directly.

**Work:**
- Create `src/voice/voice-listening-window.service.ts` — `@Injectable()` with all 8 methods
- Remove them from `VoiceTurnService`
- Add `VoiceListeningWindowService` to `VoiceTurnDependencies` and `voice.module.ts`
- Update constructor wiring: runtimes that receive these lambdas get the service instead
- Add unit tests for `VoiceListeningWindowService`

**Files:** `voice-listening-window.service.ts` (new), `voice-turn.service.ts`,
`voice-turn.dependencies.ts`, `voice.module.ts`, affected runtime files
**Risk:** Medium — touches 6+ runtimes, needs careful lambda-to-service migration

---

### TODO-4 — Extract `VoiceCallStateService` (in-memory Maps)
**Principle:** SRP, scalability, DIP
**Status:** [x] Done

**Problem:**
Two private Maps live inside `VoiceTurnService`:
- `lastResponseByCall` → used by `shouldSuppressDuplicateResponse()`
- `issuePromptAttemptsByCall` → used by `clearIssuePromptAttempts()` and increment logic

These are per-process singleton state — breaks in multi-pod deployments (dedup and retry
counters are per-instance). Also mixes state management with turn orchestration.

**Work:**
- Define interface `IVoiceCallStateService` with:
  `shouldSuppressDuplicateResponse(callSid, twiml): boolean`
  `recordResponse(callSid, twiml): void`
  `getIssuePromptAttempts(callSid): number`
  `incrementIssuePromptAttempts(callSid): void`
  `clearIssuePromptAttempts(callSid): void`
- Implement `VoiceCallStateService` backed by the same Maps (in-memory, drop-in for now)
- Remove the two Maps and related methods from `VoiceTurnService`
- Register as `@Injectable()`, add to module
- Tests: unit test the service + verify TTL/cleanup behavior

**Files:** `voice-call-state.service.ts` (new), `voice-turn.service.ts`,
`voice-turn.dependencies.ts`, `voice.module.ts`
**Risk:** Medium — touches state that affects dedup behavior, needs integration test coverage

---

### TODO-5 — Move SMS closing message builders into `VoiceSmsHandoffService`
**Principle:** SRP, cohesion
**Status:** [x] Done

**Problem:**
These private methods live on `VoiceTurnService` but logically own SMS handoff content:
- `buildSmsHandoffMessage`
- `buildSmsHandoffMessageWithFees`
- `buildSmsHandoffMessageForContext`
- `resolveSmsHandoffClosingMessage`

They already depend on `VoiceHandoffPolicyService` — they belong in `VoiceSmsHandoffService`,
which is the single authority for SMS handoff behavior.

**Work:**
- Move all four methods to `VoiceSmsHandoffService` (make them public)
- Remove them from `VoiceTurnService`
- Update all call sites (turn service + runtimes) to call `voiceSmsHandoffService.*`
- Update `VoiceSmsHandoffService` tests to cover the moved methods

**Files:** `voice-sms-handoff.service.ts`, `voice-turn.service.ts`, affected runtime files
**Risk:** Low — pure move, existing tests cover call sites

---

### TODO-6 — Extract `TwilioSignatureGuard`
**Principle:** SRP, NestJS idioms
**Status:** [x] Done

**Problem:**
`verifySignature()` is inlined in `VoiceController`. This is a cross-cutting auth concern —
NestJS has `@UseGuards()` for exactly this. Controller handles calls, guard handles auth.

**Work:**
- Create `src/voice/twilio-signature.guard.ts` — implements `CanActivate`
- Move signature check logic from `VoiceController.verifySignature()` into the guard
- Decorate all four `@Post` handlers with `@UseGuards(TwilioSignatureGuard)` (or class-level)
- Remove `verifySignature()` from controller
- Add unit tests for the guard (valid sig, missing sig, invalid sig, non-prod bypass)
- Update controller spec: remove `verifySignature` mock, add guard mock

**Files:** `twilio-signature.guard.ts` (new), `voice.controller.ts`,
`voice/__tests__/voice.controller.spec.ts`
**Risk:** Low — isolated, well-defined interface, easy to test in isolation

---

### TODO-7 — Extract `VoiceTurnRuntimeFactory` (constructor refactor)
**Principle:** OCP, DIP
**Status:** [x] Done

**Problem:**
The `VoiceTurnService` constructor is ~650 lines of manual runtime wiring. Each runtime
receives a large lambda object built from `this.private*` methods. Adding a runtime
requires modifying the service — violates OCP. The lambdas create tight implicit coupling.

**Work:**
- Create `src/voice/voice-turn-runtime.factory.ts` — `@Injectable()`
- Factory receives all dependencies via NestJS DI and exposes a `build()` method
  returning a typed `VoiceTurnRuntimeSet` record
- `VoiceTurnService` constructor calls `factory.build()` — becomes ~10 lines
- Each runtime's lambda factory becomes a private method on the factory class
- Add factory unit tests: assert each runtime is constructed with correct dependencies

**Files:** `voice-turn-runtime.factory.ts` (new), `voice-turn.service.ts`,
`voice-turn.dependencies.ts`, `voice.module.ts`
**Risk:** High — large structural change, do this last after all other seams are clean

---

## Completion checklist

- [x] TODO-1  Controller parsing via `VoiceWebhookParserService`
- [x] TODO-2  `VoiceResponseService`
- [x] TODO-3  `VoiceListeningWindowService`
- [x] TODO-4  `VoiceCallStateService`
- [x] TODO-5  SMS builders → `VoiceSmsHandoffService`
- [x] TODO-6  `TwilioSignatureGuard`
- [x] TODO-7  `VoiceTurnRuntimeFactory`

---

## Rules for this refactor

1. **One TODO per PR** — no bundling
2. **Tests first** — write/update tests for the extracted unit before moving code
3. **No logic changes** — if behavior needs to change, that's a separate PR
4. **Green CI required** before merging each step
5. **Do TODO-7 last** — the constructor refactor is safest after all other seams are extracted
