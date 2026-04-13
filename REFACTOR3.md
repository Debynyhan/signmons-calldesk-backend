# Cross-Module Refactor — Phase 3 (Structural Hardening)

Goal: remove the transitional scaffolding left from Phase 2, decompose the remaining
oversized orchestration classes, and establish architectural guardrails so future
features cannot re-introduce these patterns.

Phase 2 (REFACTOR2.md) extracted 13 services. Phase 3 assumes all of those are done.

---

## Principles being applied

| Principle | What it means here |
|---|---|
| **SRP** | Each class has one reason to change |
| **OCP** | New turn steps / tool handlers should not require editing existing orchestrators |
| **DIP** | No service manually instantiates its own dependencies — all via NestJS DI |
| **ISP** | Consumers declare only the dependency surface they actually need |
| **SoC** | Transport (controllers/gateways) is separate from use-case logic |

---

## Issues confirmed and source

| Issue | Location | Source |
|---|---|---|
| `processTurn` is a 300-line branch-heavy orchestrator | `voice-turn.service.ts:264` | Both |
| Runtime factory 1,178 lines with no sub-grouping (resolved in TODO-5) | `voice-turn-runtime.factory.ts` | Both |
| `VoiceTurnDependencies` constructor: 21 params | `voice-turn.dependencies.ts:41` | Both (user exact count) |
| `VoiceStreamDependencies` constructor: 10 params | `voice-stream.dependencies.ts:41` | User |
| `VoiceController` constructor: 11 params | `voice.controller.ts:33` | User |
| `PaymentsService` constructor: 11 params | `payments.service.ts:32` | User |
| `as Partial<...>` legacy shims in 9 locations | see table below | User (full extent) |
| `ConversationsService` manually instantiates repo | `conversations.service.ts:31` | User |
| CI has no architecture enforcement | — | User |
| `TriageOrchestratorService.handleToolCall` still mixed in `run()` | `triage-orchestrator.service.ts:268` | Mine |
| No `ICallLogService` interface — consumers import full 415-line class | `logging/call-log.service.ts` | Mine |

### All shim locations (13 total)

`as Partial<...>` type-cast shims (10):

| File | Line | Shim target |
|---|---|---|
| `voice.controller.ts` | 54 | `ConversationLifecycleService` |
| `voice-listening-window.service.ts` | 49 | `VoiceConversationStateService` |
| `voice-sms-phone-slot.service.ts` | 37 | `VoiceConversationStateService` |
| `voice-urgency-slot.service.ts` | 27 | `VoiceConversationStateService` |
| `voice-sms-handoff.service.ts` | 42 | `VoiceConversationStateService` |
| `payments/voice-intake-sms.service.ts` | 43 | `VoiceConversationStateService` |
| `payments/payments.service.ts` | 51 | `ConversationLifecycleService` |
| `sms/sms.controller.ts` | 55 | `VoiceConversationStateService` |
| `sms/sms.controller.ts` | 73 | `ConversationLifecycleService` |
| `ai/ai.service.ts` | 35 | `ConversationLifecycleService` |

`hasLegacy*` function guards (3 — same problem, different syntax):

| File | Line | Guard function | Methods checked |
|---|---|---|---|
| `voice/voice-turn.dependencies.ts` | 25 | `hasLegacyVoiceStateMethods` | `updateVoiceTranscript`, `incrementVoiceTurn` |
| `voice/voice-stream.dependencies.ts` | 14 | `hasLegacyVoiceTimingMethods` | `appendVoiceTurnTiming` |
| `voice/voice-stream.dependencies.ts` | 24 | `hasLegacyVoiceLifecycleMethods` | `ensureVoiceConsentConversation`, `completeVoiceConversationByCallSid` |

---

## TODO List

### TODO-1 — Remove all legacy shims (`as Partial<...>`)
**Principle:** SRP, DIP — remove transitional scaffolding
**Status:** [ ] Not started

**Problem:**
During Phase 2, extracted services (`VoiceConversationStateService`,
`ConversationLifecycleService`) were injected alongside the old `ConversationsService`
with runtime type-guards to pick whichever was available. This was correct scaffolding
during migration but is now dead weight. 11 shim sites remain across 9 files.
All consumers now have the correct concrete dep available — the guard is pure noise.

The `hasLegacyVoiceStateMethods` function in `voice-turn.dependencies.ts` is the most
dangerous: it silently picks the wrong service if a test doesn't wire both.

**Work:**
- In each shim location: delete the `as Partial<...>` getter and the compatibility check
- Make the extracted service the sole dep (e.g. `this.voiceConversationStateService` directly)
- In `voice-turn.dependencies.ts`: delete `hasLegacyVoiceStateMethods`; use
  `injectedVoiceConversationStateService` unconditionally
- Update any tests that only provided `conversationsService` without the extracted service

**Files:**
`voice.controller.ts`, `voice-listening-window.service.ts`, `voice-sms-phone-slot.service.ts`,
`voice-urgency-slot.service.ts`, `voice-sms-handoff.service.ts`,
`payments/voice-intake-sms.service.ts`, `payments/payments.service.ts`,
`sms/sms.controller.ts`, `ai/ai.service.ts`, `voice-turn.dependencies.ts`,
`voice-stream.dependencies.ts`

**Side effect on constructor counts:**
After removing `conversationsService` from `payments.service.ts` and
`voice-stream.dependencies.ts` (used only in their shim guards), both constructors
shrink: `PaymentsService` 11 → 10 params; `VoiceStreamDependencies` 10 → 9.
Neither reaches the TODO-8 target yet — noted in TODO-8's exception list.

**Risk:** Low — mechanical deletion. The correct deps are already injected everywhere.
Each file is independently safe; do them in one PR.

---

### TODO-2 — Fix `ConversationsService` DIP violation
**Principle:** DIP — depend on injections, never `new`
**Status:** [ ] Not started

**Problem:**
`ConversationsService` constructor (line 31) manually instantiates its repository:
```typescript
this.repository = new ConversationsRepository(this.prisma);
```
This bypasses NestJS DI entirely. `ConversationsRepository` cannot be mocked,
replaced, or observed by the container. It also hides the dependency from the
module's provider list, making the wiring invisible.

**Work:**
- Add `ConversationsRepository` to `ConversationsModule` providers
- Inject it as a constructor parameter in `ConversationsService`
- Remove `private readonly repository: ConversationsRepository` field assignment
  from the constructor body
- Update any tests that construct `ConversationsService` directly

**Files:** `conversations.service.ts`, `conversations.module.ts`
**Risk:** Low — behavior unchanged; only wiring changes.

---

### TODO-3a — Extract `VoiceInboundUseCase` from `VoiceController`
**Principle:** SoC — transport ≠ use-case
**Status:** [x] Done

**Problem:**
`VoiceController` has 11 constructor params and contains use-case logic
(tenant resolution, consent flow, streaming TwiML construction, fallback logic).
Controllers should be transport-only: parse request → delegate → serialize response.
The same inbound logic is also partially duplicated in the streaming gateway.

**Work:**
- Create `src/voice/voice-inbound.use-case.ts` — `@Injectable()` that owns:
  tenant resolution, consent check, streaming-vs-non-streaming dispatch,
  voice-disabled fallback
- `VoiceController.handleInbound` becomes: parse → `inboundUseCase.handle(params)` → write response
- Slim `VoiceController` constructor to: `config`, `twilioGuard`, `loggingService`, `voiceInboundUseCase`

**Files:** `voice.controller.ts`, `voice-inbound.use-case.ts` (new), `voice.module.ts`
**Risk:** Medium — controller behaviour must be preserved exactly; cover with integration tests.

---

### TODO-3b — Extract `SmsInboundUseCase` from `SmsController`
**Principle:** SoC — transport ≠ use-case
**Status:** [x] Done

**Problem:**
`SmsController` (299 lines, two `as Partial<...>` shims) contains use-case logic
inline. After TODO-1 removes its shims it is still a controller that owns business
logic. Same pattern as TODO-3a — separate task so each PR is focused.

**Work:**
- Create `src/sms/sms-inbound.use-case.ts` — `@Injectable()` with same
  extract-delegate pattern as `VoiceInboundUseCase`
- `SmsController` becomes: parse → `smsInboundUseCase.handle(params)` → response

**Files:** `sms/sms.controller.ts`, `sms-inbound.use-case.ts` (new), `sms.module.ts`
**Risk:** Medium — same as TODO-3a; cover with integration tests. Do after TODO-3a
is merged so you have the pattern to follow.

---

### TODO-4 — Decompose `VoiceTurnService.processTurn` into a step pipeline
**Principle:** OCP, SRP — adding a new turn step should not require editing `processTurn`
**Status:** [x] Done

**Problem:**
`processTurn` (line 264, ~300 lines) is a linear chain of 20+ runtime calls connected
by `if (x.kind === "exit") return x.value` guards. Every new turn phase requires
editing this method. The sequence is also not testable in isolation — you must drive
the entire turn to observe a mid-chain branch.

**Work:**
- Define `IVoiceTurnStep` interface:
  ```typescript
  interface IVoiceTurnStep {
    execute(ctx: VoiceTurnStepContext): Promise<VoiceTurnStepResult>;
  }
  type VoiceTurnStepResult =
    | { kind: "exit"; value: unknown }
    | { kind: "continue"; ctx: VoiceTurnStepContext };
  ```
- Create `VoiceTurnPipeline` service that holds an ordered array of `IVoiceTurnStep`
  and runs them sequentially, stopping on `"exit"`
- Wrap each existing runtime call (`turnPreludeRuntime.prepare`, `turnContextRuntime.prepareTurnContext`,
  `turnEarlyRoutingRuntime.route`, etc.) in a thin adapter implementing `IVoiceTurnStep`
- `processTurn` becomes: build initial context → `pipeline.run(context)` → return result
- Register steps in `VoiceModule` via a `VOICE_TURN_STEPS` injection token (array provider)

**Files:** `voice-turn.service.ts`, new `voice-turn-pipeline.service.ts`,
new `voice-turn.step.interface.ts`, `voice.module.ts`
**Risk:** High — behaviour of the sequential exit-chain must be exactly preserved.
Cover with full replay tests before and after.

---

### TODO-5 — Split `VoiceTurnRuntimeFactory` into domain sub-factories
**Principle:** SRP, cohesion — one factory per domain group
**Status:** [x] Done

**Problem:**
`voice-turn-runtime.factory.ts` is 1,178 lines and builds runtimes for 5 unrelated
domains in one class: prelude/context, name flow, address flow, triage/handoff,
interrupt/side-question. There is no internal grouping. Finding the wiring for a
specific domain requires searching the full file.

**Work:**
- Create 4 focused sub-factories (each < 300 lines):
  - `VoiceTurnPreludeContextFactory` — prelude + context runtimes
  - `VoiceTurnNameFlowFactory` — name opening, capture, flow, spelling
  - `VoiceTurnAddressFlowFactory` — address extraction, routing, completeness,
    confirmed, existing-candidate
  - `VoiceTurnTriageHandoffFactory` — AI triage, handoff, interrupt, side-question
- `VoiceTurnRuntimeFactory` becomes a thin coordinator that delegates to each sub-factory
  and exposes the final runtime bag
- Target: main factory < 200 lines; each sub-factory < 300 lines

**Files:** `voice-turn-runtime.factory.ts` (split), 4 new sub-factory files, `voice.module.ts`
**Risk:** Low — pure structural reorganisation of wiring code; no logic changes.

**Implemented (TODO-5 + TODO-5b follow-up):**
- `VoiceTurnRuntimeFactory` is now a thin coordinator (35 lines)
- Added and wired 4 focused sub-factories:
  - `voice-turn-prelude-context.factory.ts` (231 lines)
  - `voice-turn-name-flow.factory.ts` (191 lines)
  - `voice-turn-address-flow.factory.ts` (183 lines)
  - `voice-turn-triage-handoff.factory.ts` (287 lines)
- Added shared helper slices to keep sub-factories cohesive:
  - `voice-turn-runtime-coordination.helpers.ts`
  - `voice-turn-address-flow.helpers.ts`
  - `voice-turn-triage-handoff.runtime-builders.ts`
- Extracted step assembly into `voice-turn-step.factory.ts` and kept `VOICE_TURN_STEPS` wiring in `voice.module.ts`
- Updated factory coverage test wiring:
  - `src/voice/__tests__/voice-turn-runtime.factory.spec.ts`
- Validation run passed:
  - `npm run build`
  - `npm run test -- voice/__tests__/voice-turn-runtime.factory.spec.ts --runInBand`
  - `npm run test:voice:replay`
- Reference commit: `3e439d6` (`refactor(voice): complete TODO-5 runtime factory split`)

---

### TODO-6 — Add service interfaces and injection tokens (DIP / ISP)
**Principle:** DIP, ISP — consumers declare only the surface they need
**Status:** [x] Done
**Depends on:** TODO-2 merged

**Problem:**
Three high-usage services are imported as concrete classes throughout the codebase,
making them impossible to swap or narrow in tests without the full class.

**6a — `ICallLogService` does not exist**
`CallLogService` is 415 lines with three distinct call shapes:
`createLog` (AI/SMS path), `createVoiceTranscriptLog` (voice path),
`createVoiceAssistantLog` (voice path). Every consumer imports the full 415-line
class even when they only call one method.

**6b — `IConversationLifecycleService` does not exist**
`ConversationLifecycleService` is imported directly by `AiService`, `VoiceController`,
`SmsController`, and payments services. No injection token exists — swapping in a
stub requires mocking the full class.

**6c — `IVoiceConversationStateService` does not exist**
`VoiceConversationStateService` is directly imported by all voice slot services and
the sms/payments modules. Same problem as 6b.

**Work:**
- Define `ICallLogService` in `src/logging/call-log.service.interface.ts`;
  register under token `CALL_LOG_SERVICE`
- Define `IConversationLifecycleService` in
  `src/conversations/conversation-lifecycle.service.interface.ts`;
  register under token `CONVERSATION_LIFECYCLE_SERVICE`
- Define `IVoiceConversationStateService` in
  `src/voice/voice-conversation-state.service.interface.ts`;
  register under token `VOICE_CONVERSATION_STATE_SERVICE`
- Update all consumers to inject via token, narrow to the interface methods they use
- Update test doubles to implement the interface rather than mocking the class

**Files:** 3 new interface files, `logging.module.ts`, `conversations.module.ts`,
`voice.module.ts`, all consumers of the three services
**Risk:** Low-medium — mechanical token wiring; all tests need mock shapes updated.

---

### TODO-7 — Extract `ToolDispatchService` from `TriageOrchestratorService`
**Principle:** SRP — `run()` should not own tool dispatch internals
**Status:** [x] Done

**Problem:**
`TriageOrchestratorService.run()` owns: router-flow decision, while-loop control,
tool call validation (`validateAssistantMessage`), AND tool execution (`handleToolCall`
~80 lines). The private `handleToolCall` method handles executor lookup, route
continuation detection, loop-guard triggering, error handling, and telemetry — five
distinct concerns in one private method.

**Work:**
- Create `src/ai/tool-dispatch.service.ts` — `@Injectable()` with:
  - `dispatch(context: ToolDispatchContext): Promise<ToolDispatchResult>`
  - Owns: executor lookup, route-continuation result detection, loop-guard logging,
    error delegation to `AiErrorHandler`
- Remove `handleToolCall` and `isFunctionToolCall` from `TriageOrchestratorService`
- `run()` calls `this.toolDispatch.dispatch(...)` — the while-loop becomes ~60 lines
- Register in `AiModule`, export

**Files:** `triage-orchestrator.service.ts`, new `tool-dispatch.service.ts`, `ai.module.ts`
**Risk:** Low — `handleToolCall` is already an isolated private method; extracting it
is mechanical.

---

### TODO-8 — Architecture guardrails in CI
**Principle:** Prevent regression of all the above
**Status:** [x] Done

**Problem:**
None of the constraints enforced by Phases 2 and 3 are machine-checked. A future
feature can re-introduce a 1,000-line service, a 21-param constructor, or a
`as Partial<...Service>` shim without any CI failure.

**Work:**
- Create `scripts/arch-check.ts` using the TypeScript compiler API (ts-morph or
  `typescript` directly) — not grep — so checks are structurally precise:

  1. **Line count gate**: no non-spec `.ts` file > 900 lines.
     *(Current largest after Phase 3: `triage-orchestrator.service.ts` ~480 → 300 after TODO-7.)*

  2. **Constructor param gate**: parse constructor parameter lists via AST.
     - Orchestrator/controller classes (names matching `*Service` or `*Controller`
       excluding DI-bag classes): fail if > 8 params
     - Explicit exceptions (classes whose purpose IS dep aggregation):
       `VoiceTurnDependencies` (21 → no reduction planned here),
       `VoiceStreamDependencies` (10 → 9 after TODO-1, further reduction is
       TODO-3 scope). Add exceptions as comments in the script so they are visible.
     - Domain service target: ≤ 6 params (PaymentsService is 10 → 9→ after TODO-1;
       add to exception list until a follow-on TODO reduces it further)

  3. **Shim gate (two rules)**:
     - `as Partial<.*Service` in source files → 0 results
     - `hasLegacy[A-Z]` function declarations → 0 results

  4. **Manual-instantiation gate (AST only)**: using ts-morph, walk constructor
     bodies of `*.service.ts` files; fail if any statement is an assignment of the
     form `this.<field> = new SomeClass(...)`. Regex (`= new [A-Z]`) is too broad
     and will false-positive on factory methods and test files — do not use grep.

- Add `"arch:check": "ts-node scripts/arch-check.ts"` to `package.json`
- Add `arch:check` step to CI pipeline (after build, before deploy)

**Files:** new `scripts/arch-check.ts`, `package.json`, CI config
**Risk:** Low — additive only; no application code changes.

---

### TODO-9 — Enforce module boundary rules
**Principle:** SoC, OCP — services in module A should not import concrete types from module B
**Status:** [x] Done
**Depends on:** TODO-8 merged (add as gate #5 in the same script)

**Problem:**
NestJS module boundaries are purely runtime-enforced — nothing prevents a voice service
from importing an AI concrete class directly, bypassing the module's `exports` list.
This defeats the purpose of the module registry and makes dependency graphs
invisible to the container.

Two patterns are currently in use that will re-proliferate without a gate:
- Direct cross-module concrete imports (e.g. `voice/*.ts` importing from `ai/*.ts`
  other than through an injection token)
- `providers` containing services from another module that are not re-exported
  (makes the dep invisible in the module graph)

**Work:**
- Extend `scripts/arch-check.ts` with a **module boundary gate**:
  - Parse every `*.module.ts` and collect its declared `providers` and `exports`
  - For each `*.service.ts` / `*.controller.ts` in a module's directory, check
    that any imported path crossing a module boundary resolves to either:
    (a) an injection token constant (`*constants.ts`), or
    (b) an interface file (`*.interface.ts`)
  - Fail on any direct concrete-class import from a different module's non-interface files
- Document the approved cross-boundary seams as an allowlist comment in the script

**Files:** `scripts/arch-check.ts` (extend), no application code changes
**Risk:** Low — additive gate only. Will surface real violations in the existing
codebase that can be fixed incrementally.

**Implemented:**
- Added Gate 5 in `scripts/arch-check.ts`: module-boundary validation for:
  - cross-module imports in `*.service.ts` / `*.controller.ts`
  - cross-module provider registrations in `*.module.ts` (`providers` vs target-module `exports`)
- Module metadata is now parsed from `@Module(...)` decorators via AST and used for boundary checks.
- Approved seams are documented inline as explicit allowlist entries (prefix + exact-file lists with rationale comments).
- Validation run passed:
  - `npm run arch:check`
  - `npm run build`

---

## Priority order

| # | TODO | Phase | Effort | Unblocks |
|---|---|---|---|---|
| 1 | TODO-1 — Remove shims | 3A | 1 day | TODO-2, TODO-3a, TODO-3b |
| 2 | TODO-2 — ConversationsService DIP | 3A | 0.5 day | TODO-6 |
| 3 | TODO-7 — ToolDispatchService | 3A | 1 day | — |
| 4 | TODO-3a — VoiceInboundUseCase | 3D | 2 days | TODO-3b |
| 5 | TODO-3b — SmsInboundUseCase | 3D | 1 day | — |
| 6 | TODO-4 — VoiceTurnPipeline | 3B | 4 days | TODO-5 |
| 7 | TODO-5 — Split factory | 3C | 2 days | — |
| 8 | TODO-6 — Service interfaces + tokens | 3E | 3 days | — |
| 9 | TODO-8 — CI guardrails (gates 1–4) | 3F | 1.5 days | all |
| 10 | TODO-9 — Module boundary gate | 3F | 1 day | TODO-8 |

Do TODO-8 and TODO-9 last — guardrails are only meaningful once the violations are gone.

---

## Completion checklist

- [x] TODO-1  Remove shims (10 `as Partial<...>` + 3 `hasLegacy*` guards = 13 sites)
- [x] TODO-2  Fix `ConversationsService` DIP violation (inject `ConversationsRepository`)
- [x] TODO-2  Inject `ConversationsRepository` via DI
- [x] TODO-3a `VoiceInboundUseCase`
- [x] TODO-3b `SmsInboundUseCase`
- [x] TODO-4  `VoiceTurnPipeline` + `IVoiceTurnStep`
- [x] TODO-5  Split `VoiceTurnRuntimeFactory` (4 sub-factories)
- [x] TODO-6  `ICallLogService` + `IConversationLifecycleService` + `IVoiceConversationStateService` interfaces + tokens
- [x] TODO-7  `ToolDispatchService`
- [x] TODO-8  CI architecture guardrails (line count, constructor, shim, manual-new gates)
- [x] TODO-9  Module boundary gate (extend arch-check script)

---

## Definition of Done

A TODO is **done** when ALL of the following are true:

| Criterion | What is checked |
|---|---|
| **Tests written first** | New spec file (or updated spec) before any code moves |
| **New service/interface created** | In the correct module directory |
| **Logic removed from source** | Methods deleted from originating class — not duplicated |
| **All call sites updated** | Every consumer now uses the new seam |
| **Module wiring complete** | Registered in `providers` and `exports` as needed |
| **Full test suite green** | `npx jest --no-coverage` exits 0, no new failures |
| **Voice replay regression** | For TODOs touching turn execution (TODO-3a, TODO-4, TODO-5): replay tests pass with identical turn output before and after |
| **Call-quality audit** | For TODOs touching streaming (TODO-3a, TODO-4): `CommunicationEventType.CALL_QUALITY` audit events still fire in test; SLA telemetry assertions unchanged |
| **Checklist updated** | `[ ]` → `[x]` above |

---

## Rules for this refactor

1. **One TODO per PR** — no bundling
2. **Tests first** — write/update specs before moving code
3. **No logic changes** — behavior-identical refactors only; logic changes are separate PRs
4. **TODO-1 before TODO-3a/3b** — shims must be gone before thinning the controllers
5. **TODO-3a before TODO-3b** — establish the voice pattern before applying to SMS
6. **TODO-4 before TODO-5** — pipeline must work before reorganising its factory
7. **TODO-2 before TODO-6** — ConversationsRepository must be injected before defining its interface
8. **TODO-8 before TODO-9** — base guardrails in place before adding boundary gate
9. **TODO-8 and TODO-9 last** — guardrails go in only after all violations are resolved
10. **Green CI required** before merging each step
