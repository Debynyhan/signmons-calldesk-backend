# Cross-Module Refactor — SOLID / SoC / SRP (Phase 2)

Goal: apply the same principles used in the voice module refactor to the remaining
modules. Every service over 300 lines has mixed concerns; this plan resolves them
one seam at a time. Each TODO is a standalone PR. Do them in order — later steps
depend on earlier seams.

---

## Principles being applied

| Principle | What it means here |
|---|---|
| **SRP** | Each class has one reason to change |
| **OCP** | New event types / strategies should not require editing existing services |
| **ISP** | Services only depend on the interface they actually use |
| **DIP** | Depend on abstractions where cross-module coupling exists |
| **SoC** | Orchestration, business logic, state mutation, HTTP concerns are separate |

---

## Affected services at a glance

| Service | Lines | Primary violation |
|---|---|---|
| `ConversationsService` | 1,196 | God class — lifecycle + voice state mutations + queries |
| `PaymentsService` | 921 | Mixed Stripe webhook, fee calc, SMS dispatch, state persistence |
| `AiService` | 739 | God method (`triage` ~230 lines) + extraction + validation + telemetry |
| `JobsService` | 525 | Normalization tables + validation embedded in job creation |
| `MarketingService` | 485 | Twilio client, lead lifecycle, rate limiting, status mapping |
| `CallLogService` | 438 | PII masking utility embedded in logging service |
| `TenantsService` | 303 | Prompt building + fee policy sync mixed with tenant CRUD |

---

## TODO List

### TODO-1 — Extract `PiiObfuscator` from `CallLogService`
**Principle:** SRP, reusability
**Status:** [x] Done

**Problem:**
`CallLogService.obfuscatePii()` (line 413) is a pure utility that masks phone
numbers and addresses using regex. It is currently unreachable by other services
that also handle PII (payments, sms, marketing). No service should own a
cross-cutting utility as a private method.

**Work:**
- Create `src/logging/pii-obfuscator.service.ts` — `@Injectable()` with one public method `obfuscate(value: string): string`
- Remove `private obfuscatePii()` from `CallLogService`
- Inject `PiiObfuscatorService` into `CallLogService`; update all call sites
- Register in `LoggingModule`; export so other modules can use it
- Unit tests: phone masking, address masking, mixed content, empty string

**Files:** `pii-obfuscator.service.ts` (new), `call-log.service.ts`, `logging.module.ts`
**Risk:** Very low — pure function, no dependencies, zero logic change

---

### TODO-2 — Extract `IssueNormalizer` from `JobsService`
**Principle:** SRP, cohesion
**Status:** [x] Done

**Problem:**
`JobsService` contains ~80 lines of normalization logic that has nothing to do
with job creation orchestration:
- `normalizeIssueCategory()` (line 432) — 39-entry mapping table
- `normalizeUrgency()` (line 471)
- `normalizePreferredTime()` (line 485)
- `isPreferredTimeValid()` (line 500)
- `mapUrgency()` (line 507)
- `mapPreferredWindow()` (line 511)

These are pure transformations with no DB or service dependencies.

**Work:**
- Create `src/jobs/issue-normalizer.service.ts` — `@Injectable()` with the six methods as public
- Remove those methods from `JobsService`; inject `IssueNormalizerService`
- Register in `JobsModule`
- Unit tests: all issue category mappings, urgency values, preferred time parsing, invalid inputs

**Files:** `issue-normalizer.service.ts` (new), `jobs.service.ts`, `jobs.module.ts`
**Risk:** Very low — pure transformation, no side effects

---

### TODO-3 — Extract `TenantPromptBuilder` from `TenantsService`
**Principle:** SRP, OCP
**Status:** [x] Done

**Problem:**
`TenantsService.buildPrompt()` (line 256) constructs the AI system prompt from
tenant settings. Prompt logic has its own reason to change (copy changes, new
prompt fields) independently of tenant CRUD. It is also untestable in isolation
because it lives inside the tenant service.

**Work:**
- Create `src/tenants/tenant-prompt-builder.service.ts` — `@Injectable()` with `buildPrompt(settings, feePolicySummary?): string`
- Remove `private buildPrompt()` from `TenantsService`; inject and delegate
- Register in `TenantsModule`
- Unit tests: prompt with full settings, missing fields, fee policy variants

**Files:** `tenant-prompt-builder.service.ts` (new), `tenants.service.ts`, `tenants.module.ts`
**Risk:** Very low — pure logic, no I/O

---

### TODO-4 — Extract `TenantFeePolicySynchronizer` from `TenantsService`
**Principle:** SRP
**Status:** [x] Done

**Problem:**
`TenantsService.syncTenantFeePolicy()` (line 118) is ~62 lines of transaction
management, policy normalization, and upsert logic. It has a distinct reason to
change from tenant lookup or prompt building. `updateTenantFeeSettings()` (line 180)
is a companion that also mixes persistence and business logic.

**Work:**
- Create `src/tenants/tenant-fee-policy-synchronizer.service.ts` — `@Injectable()` with `sync()` and `updateSettings()` as public methods
- Move the two methods; inject `PrismaService` directly into the new service
- Remove from `TenantsService`; inject and delegate
- Register in `TenantsModule`
- Unit tests: sync creates when missing, sync updates when present, settings update propagation

**Files:** `tenant-fee-policy-synchronizer.service.ts` (new), `tenants.service.ts`, `tenants.module.ts`
**Risk:** Low — well-scoped transaction logic, no cross-module calls

---

### TODO-5 — Extract `VoiceConversationStateService` (voice state mutations → voice module)
**Principle:** SRP, SoC, cohesion
**Status:** [x] Done

**Problem:**
`ConversationsService` owns 16 voice-specific state mutation methods (lines
374–1175) that belong conceptually to the voice module. They update the
`collectedData` JSON blob for voice turns. The conversations module should not
own voice domain logic — that couples two modules at the wrong level.

Methods moving to the voice module:
- `updateVoiceTranscript`
- `updateVoiceIssueCandidate`
- `incrementVoiceTurn`
- `updateVoiceNameState`
- `updateVoiceSmsPhoneState`
- `updateVoiceSmsHandoff`
- `updateVoiceComfortRisk`
- `updateVoiceUrgencyConfirmation`
- `clearVoiceSmsHandoff`
- `updateVoiceAddressState`
- `updateVoiceListeningWindow`
- `clearVoiceListeningWindow`
- `updateVoiceLastEventId`
- `appendVoiceTurnTiming`
- `promoteNameFromSms`
- `promoteAddressFromSms`

**Work:**
- Create `src/voice/voice-conversation-state.service.ts` — `@Injectable()` with all 16 methods; inject `ConversationsRepository` directly (not the full ConversationsService)
- Remove the 16 methods from `ConversationsService`
- Add `VoiceConversationStateService` to `VoiceTurnDependencies` and `voice.module.ts`; export `ConversationsRepository` from `ConversationsModule`
- Update `VoiceTurnRuntimeFactory`: every lambda calling `this.deps.conversationsService.updateVoice*` or `this.deps.conversationsService.incrementVoiceTurn` etc. routes to `this.deps.voiceConversationStateService.*`
- Update `VoiceStreamGateway` and any other voice consumers calling these methods
- Unit tests: each update method, merge behavior, state getters on output

**Files:** `voice-conversation-state.service.ts` (new), `conversations.service.ts`,
`voice-turn.dependencies.ts`, `voice-turn-runtime.factory.ts`, `voice.module.ts`,
`conversations.module.ts`, `voice-stream.gateway.ts`
**Risk:** Medium — touches many call sites; careful lambda-by-lambda migration needed

---

### TODO-6 — Extract `ConversationLifecycleService` from `ConversationsService`
**Principle:** SRP
**Status:** [ ] Not started

**Problem:**
After TODO-5, `ConversationsService` still contains conversation creation and
completion logic (~400 lines) that is a separate concern from state queries:
- `ensureConversation` — SMS/chat session setup
- `ensureSmsConversation` — SMS-specific consent and linking
- `ensureVoiceConsentConversation` — voice call setup with customer resolution
- `completeVoiceConversationByCallSid` — marks call complete, logs outcome
- `linkJobToConversation` — post-booking linkage

**Work:**
- Create `src/conversations/conversation-lifecycle.service.ts` — `@Injectable()` with the five methods; inject `ConversationsRepository`, `ConversationCustomerResolver`, `SanitizationService`, `LoggingService`
- Remove the five methods from `ConversationsService`
- Export from `ConversationsModule`; update all consumers (`VoiceController`, `VoiceStreamGateway`, `SmsService`, `JobsService`) to inject `ConversationLifecycleService`
- Unit tests: ensure creates when missing, ensure returns existing, complete updates status

**Files:** `conversation-lifecycle.service.ts` (new), `conversations.service.ts`,
`conversations.module.ts`, `voice.controller.ts`, `voice-stream.gateway.ts`
**Risk:** Medium — controller and gateway wiring changes; no logic change

---

### TODO-7 — Extract `IntakeFeeCalculator` from `PaymentsService`
**Principle:** SRP, SoC
**Status:** [ ] Not started

**Problem:**
`PaymentsService.resolveIntakeContext()` (line 373, ~72 lines) is pure business
logic that computes intake fee context from a token. It depends on `PrismaService`
and `TenantsService` — not on Stripe. It is tangled with `getIntakePageData()` and
`computeTotalCents()` (line 780), `inferIssueCategory()` (line 793), and
`formatFeeAmount()` (line 857). These form a cohesive fee-calculation group
independent of payment processing.

**Work:**
- Create `src/payments/intake-fee-calculator.service.ts` — `@Injectable()` with `resolveIntakeContext()`, `computeTotalCents()`, `inferIssueCategory()`, `formatFeeAmount()` as public methods
- Remove those methods from `PaymentsService`; inject and delegate
- `getIntakePageData()` stays in `PaymentsService` but delegates context resolution to the new service
- Register in `PaymentsModule`
- Unit tests: fee computation with various fee policies, issue category inference, formatting edge cases

**Files:** `intake-fee-calculator.service.ts` (new), `payments.service.ts`, `payments.module.ts`
**Risk:** Low — pure logic, no Stripe calls, no side effects

---

### TODO-8 — Extract `StripeEventProcessor` from `PaymentsService`
**Principle:** SRP, OCP
**Status:** [ ] Not started

**Problem:**
`PaymentsService.handleStripeWebhook()` dispatches to `processStripeEvent()` (line
611, ~108 lines) which handles three event types inline. Adding a fourth event type
requires modifying `PaymentsService`. The processing logic (checkout.session.completed,
checkout.session.expired, payment_intent.payment_failed) is a distinct concern from
session creation.

Related private methods that move:
- `parseWebhookEvent()` (line 553)
- `extractTenantId()` (line 577)
- `createStripeEventRecord()` (line 582)
- `processStripeEvent()` (line 611)
- `findPaymentForCheckoutSessionComplete()` (line 719)

**Work:**
- Create `src/payments/stripe-event-processor.service.ts` — `@Injectable()` with `process(event: Stripe.Event): Promise<void>` as the public surface; private handlers per event type
- Define `IStripeEventProcessor` interface in the same file
- `PaymentsService.handleStripeWebhook()` parses the raw request and delegates to the processor
- Register in `PaymentsModule`
- Unit tests: each event type handled, unknown event type is no-op, Stripe error propagates

**Files:** `stripe-event-processor.service.ts` (new), `payments.service.ts`, `payments.module.ts`
**Risk:** Low-medium — well-defined seam; webhook behavior must be verified end-to-end

---

### TODO-9 — Extract `VoiceIntakeSmsService` from `PaymentsService`
**Principle:** SRP, SoC
**Status:** [ ] Not started

**Problem:**
`PaymentsService.sendVoiceHandoffIntakeLink()` (line 233, ~89 lines) sends an SMS
containing an intake link. It depends on `SmsService`, `ConversationsService`, and
`SanitizationService` — but not on Stripe. It also performs conversation state
updates (`persistSmsIntakeFields`, line 447) that are post-handoff concerns, not
payment concerns.

Methods moving:
- `sendVoiceHandoffIntakeLink()` (line 233) — becomes the public entry point
- `persistSmsIntakeFields()` (line 447) — companion state write

**Work:**
- Create `src/payments/voice-intake-sms.service.ts` — `@Injectable()` with the two methods; inject `SmsService`, `ConversationsService`, `SanitizationService`, `PrismaService`
- Remove from `PaymentsService`; inject and delegate
- `VoiceTurnHandoffRuntime` currently calls `paymentsService.sendVoiceHandoffIntakeLink()` — update `VoiceTurnDependencies` and factory to point to the new service
- Register in `PaymentsModule`; export
- Unit tests: SMS dispatched with correct payload, intake fields persisted, phone normalization

**Files:** `voice-intake-sms.service.ts` (new), `payments.service.ts`, `payments.module.ts`,
`voice-turn.dependencies.ts`, `voice-turn-runtime.factory.ts`
**Risk:** Low — clean seam; voice module wiring update is mechanical

---

### TODO-10 — Extract `CreateJobPayloadValidator` from `JobsService`
**Principle:** SRP
**Status:** [ ] Not started

**Problem:**
`JobsService` mixes job creation orchestration with payload parsing and validation:
- `parseAndNormalizePayload()` (line 185)
- `findUnexpectedKeys()` (line 223)
- `parseRawArgs()` (line 236)
- `validatePayload()` (line 289)
- `buildValidationError()` (line 298)

These 5 methods form a validation pipeline that runs before any DB call. They are
separately testable and have no business logic dependency on job creation.

**Work:**
- Create `src/jobs/create-job-payload-validator.service.ts` — `@Injectable()` with `parseAndNormalize(rawArgs?: string)` as the public entry; internal helpers private
- Remove the five methods from `JobsService`; inject and delegate
- `IssueNormalizerService` (TODO-2) is injected here, not in `JobsService`
- Register in `JobsModule`
- Unit tests: valid payload passes, unexpected key throws, missing required field throws, raw JSON parse error handled

**Files:** `create-job-payload-validator.service.ts` (new), `jobs.service.ts`, `jobs.module.ts`
**Risk:** Low — well-scoped pipeline, no DB calls

---

### TODO-11 — Extract `DemoCallService` from `MarketingService`
**Principle:** SRP, OCP
**Status:** [ ] Not started

**Problem:**
`MarketingService` mixes Twilio client management with lead lifecycle management:
- `placeDemoCall()` (line 284) — Twilio REST API call placement
- `getTwilioClient()` (line 365) — lazy Twilio client init
- `mapCallStatus()` (line 416) — Twilio status → internal status
- `mapLeadCallStatus()` (line 431) — internal status display mapping
- `buildRetryInfo()` (line 446) — retry window calculation
- `normalizeFailureReason()` (line 463)

Swapping the call provider or adding a second provider requires editing
`MarketingService`. Twilio-specific logic should be isolated.

**Work:**
- Create `src/marketing/demo-call.service.ts` — `@Injectable()` with `place(lead: MarketingLead): Promise<TryDemoResponse>` and `mapStatus(raw: string): MarketingLeadStatus | null` as public surface
- Move Twilio client, call placement, status mapping, retry logic into it
- `MarketingService` delegates `placeDemoCall` and status resolution to `DemoCallService`
- Register in `MarketingModule`
- Unit tests: call placement delegates to Twilio, status mapping table exhaustive, retry window calculation

**Files:** `demo-call.service.ts` (new), `marketing.service.ts`, `marketing.module.ts`
**Risk:** Medium — Twilio client state moves; verify lazy init behavior is preserved

---

### TODO-12 — Extract `AiExtractionService` from `AiService`
**Principle:** SRP, cohesion
**Status:** [ ] Not started

**Problem:**
`AiService` contains ~150 lines of name/address extraction logic (lines 281–522)
that is fully separable from triage orchestration:
- `extractNameCandidate()` (line 281) — LLM call + JSON parse
- `extractAddressCandidate()` (line 337) — LLM call + JSON parse
- `parseNameJson()` (line 443) — JSON string → string | null
- `parseAddressJson()` (line 461) — JSON string → structured result
- `normalizeConfidence()` (line 509) — confidence value normalization

These have a single reason to change (extraction schema or model changes) and are
called by voice runtimes independently of `triage()`.

**Work:**
- Create `src/ai/ai-extraction.service.ts` — `@Injectable()` exposing `extractNameCandidate()`, `extractAddressCandidate()`, `normalizeConfidence()` as public methods; JSON parsers as private
- Remove the five methods from `AiService`; inject and delegate
- Update voice module consumers (`VoiceTurnDependencies`, `voice-turn-runtime.factory.ts`) to inject `AiExtractionService` instead of calling `aiService.extractNameCandidate()`
- Register in `AiModule`; export
- Unit tests: valid JSON parsed, malformed JSON returns null, confidence normalization edge cases

**Files:** `ai-extraction.service.ts` (new), `ai.service.ts`, `ai.module.ts`,
`voice-turn.dependencies.ts`, `voice-turn-runtime.factory.ts`
**Risk:** Low-medium — clean method group; voice wiring update is mechanical

---

### TODO-13 — Extract `TriageOrchestrator` from `AiService.triage()`
**Principle:** SRP, SoC — god method decomposition
**Status:** [ ] Not started

**Problem:**
`AiService.triage()` (line 50, ~230 lines) is a god method with a while-loop that
owns too many concerns simultaneously:
1. **Conversation resolution** — fetching history, building message array
2. **Prompt orchestration** — calling `PromptOrchestrationService`
3. **AI provider dispatch** — calling `AiProviderService`
4. **Tool call handling** — `handleToolCall()` (line 524, ~87 lines)
5. **Response validation** — `validateAssistantMessage()` (line 611, ~68 lines)
6. **Loop control** — `routeContinuationCount`, continuation guard
7. **Telemetry** — `logAiEvent()`, `logAiTrace()`

Additionally, `handleToolCall()` and `validateAssistantMessage()` are private methods
that cannot be unit-tested in isolation.

**Work:**
- Create `src/ai/triage-orchestrator.service.ts` — `@Injectable()` that owns the while-loop, tool dispatch, and response validation
- Define `ITriageOrchestrator` interface with `run(params): Promise<TriageResult>`
- Move `handleToolCall()` and `validateAssistantMessage()` into it as private methods; `logAiEvent()` and `logAiTrace()` also move
- `AiService.triage()` becomes a thin delegator: resolve conversation → call `orchestrator.run()` → return result
- Register in `AiModule`
- Unit tests: single-turn success, tool call loop completes, loop guard fires on excess continuations, invalid assistant message handled, refusal detected

**Files:** `triage-orchestrator.service.ts` (new), `ai.service.ts`, `ai.module.ts`
**Risk:** High — complex stateful loop; do this last after all other seams are clean

---

## Completion checklist

- [x] TODO-1   `PiiObfuscator`
- [x] TODO-2   `IssueNormalizer`
- [x] TODO-3   `TenantPromptBuilder`
- [x] TODO-4   `TenantFeePolicySynchronizer`
- [x] TODO-5   `VoiceConversationStateService`
- [ ] TODO-6   `ConversationLifecycleService`
- [ ] TODO-7   `IntakeFeeCalculator`
- [ ] TODO-8   `StripeEventProcessor`
- [ ] TODO-9   `VoiceIntakeSmsService`
- [ ] TODO-10  `CreateJobPayloadValidator`
- [ ] TODO-11  `DemoCallService`
- [ ] TODO-12  `AiExtractionService`
- [ ] TODO-13  `TriageOrchestrator`

---

## Definition of Done

A TODO is **done** when ALL of the following are true:

| Criterion | What is checked |
|---|---|
| **Tests written first** | New spec file exists and tests are written before any code moves |
| **New service created** | `@Injectable()` class in the correct module directory |
| **Logic removed from source** | Methods deleted from the originating service — not duplicated |
| **All call sites updated** | Every consumer of the old method now calls the new service |
| **Module wiring complete** | New service registered in `providers` (and `exports` if cross-module) |
| **Full test suite green** | `npx jest --no-coverage` exits 0 with no new failures |
| **Checklist updated** | `[ ]` → `[x]` in the completion checklist above |

No TODO is done if any criterion is unmet. A green test suite is the non-negotiable gate.

---

## Rules for this refactor

1. **One TODO per PR** — no bundling
2. **Tests first** — write/update tests for the extracted unit before moving code
3. **No logic changes** — if behavior needs to change, that is a separate PR
4. **Green CI required** before merging each step
5. **Do TODO-13 last** — `TriageOrchestrator` is safest after all other seams are extracted
6. **TODO-5 before TODO-6** — remove voice mutations from conversations before splitting lifecycle
7. **TODO-2 before TODO-10** — `IssueNormalizer` is injected by `CreateJobPayloadValidator`
8. **TODO-12 before TODO-13** — extraction methods must be out of `AiService` before the triage loop is moved

---

## Expected outcome per module

| Module | Before | After | Reduction |
|---|---|---|---|
| `ConversationsService` | 1,196 lines | ~200 lines | −83% |
| `PaymentsService` | 921 lines | ~300 lines | −67% |
| `AiService` | 739 lines | ~250 lines | −66% |
| `JobsService` | 525 lines | ~280 lines | −47% |
| `MarketingService` | 485 lines | ~290 lines | −40% |
| `CallLogService` | 438 lines | ~400 lines | −9% |
| `TenantsService` | 303 lines | ~180 lines | −41% |
