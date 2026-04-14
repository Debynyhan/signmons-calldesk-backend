# Signmons CallDesk — REFACTOR4: Security Hardening & Architecture Completion

## Context

REFACTOR3 left the codebase with a working pipeline refactor, interface tokens on three high-usage
services, and five CI architecture gates. This plan addresses the remaining security gaps, access
control holes, and architectural violations identified in the post-REFACTOR3 audit.

**What is already solid (do not re-do):**
- `ValidationPipe` is properly hardened (`whitelist`, `forbidNonWhitelisted`, `transform`) in `main.ts`
- Global + per-tenant throttling in place (`app.module.ts`, `TenantThrottleGuard`)
- Twilio signature validation (`twilio-signature.guard.ts`)
- Global exception filter sanitizes all HTTP error responses (`sanitized-exception.filter.ts`)
- CI architecture gates 1–5 (`scripts/arch-check.ts`)
- Interface tokens for `ICallLogService`, `IConversationLifecycleService`, `IVoiceConversationStateService`

**What is not solid and needs fixing (this plan):**
1 critical prod npm vulnerability, missing security headers, timing-unsafe admin auth, Stripe
verification bypass on non-prod, raw error re-throws, no subscription gating, ISP/DIP violations
across ConversationsService and VoiceConversationStateService, OCP problem in the step factory,
and no webhook body DTO boundary.

---

## Phase A — Security Baseline

*Do these first. Each is a standalone fix with no dependencies on the others.*

### A1 — Fix critical npm vulnerability (axios SSRF)

**Finding:** `npm audit --omit=dev` reports 1 critical severity vulnerability in `axios`:
- `NO_PROXY` hostname normalization bypass → Server-Side Request Forgery
- Exfiltration of cloud metadata via header injection chain
- Current dependency path (verified in this repo): `twilio -> axios@1.13.5`

**Work:**
- Run `npm audit --omit=dev --json` to identify the exact dependent chain
- Prefer upgrading the direct parent (`twilio`) to a version that pulls a patched `axios`
- If immediate parent upgrade is not available, pin `axios` via `overrides` in `package.json`
- If not overridable without breaking direct dependents: open a tracking issue and add a
  network-level control (block `169.254.169.254` outbound at infrastructure level as a compensating
  control until the dep chain is updated)
- Add `npm audit --omit=dev --audit-level=critical` as Gate 6 in `scripts/arch-check.ts`,
  failing CI on any critical severity prod dependency

**Files:** `package.json` (overrides), `scripts/arch-check.ts` (Gate 6)

---

### A2 — Add security headers (helmet)

**Finding:** `main.ts` has no `helmet()` call. Missing HTTP security headers:
`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`,
`Content-Security-Policy`.

**Work:**
```typescript
// main.ts — after NestFactory.create, before app.enableCors
import helmet from "helmet";
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,  // required for Twilio media streams
}));
```
Install: `npm install helmet`

**Files:** `src/main.ts`, `package.json`

---

### A3 — Timing-safe admin token comparison

**Finding:** `admin-api.guard.ts:23` uses `!==` for string comparison:
```typescript
if (!providedToken || providedToken !== this.config.adminApiToken) {
```
JavaScript string `!==` is not constant-time. An attacker can use timing side-channels to
brute-force the token one character at a time.

**Fix:**
```typescript
import { timingSafeEqual } from "crypto";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
// replace:  providedToken !== this.config.adminApiToken
// with:     !safeCompare(providedToken, this.config.adminApiToken)
```

**Files:** `src/common/guards/admin-api.guard.ts`

---

### A4 — Explicit local-only Stripe webhook bypass flag (default fail-closed)

**Finding:** `stripe-event-processor.service.ts:54` returns `req.body as Stripe.Event`
without any signature verification when `stripeWebhookSecret` is absent or when not in
production mode. A staging environment without the env var configured would accept any
forged webhook body as a valid Stripe event.

**Fix:** Fail closed by default, with an explicit local-development escape hatch.
Add `STRIPE_WEBHOOK_ALLOW_INSECURE_LOCAL=false` and allow bypass only when
`NODE_ENV=development` **and** that flag is explicitly `true`.
```typescript
const allowInsecureLocal =
  this.config.environment === "development" &&
  this.config.stripeWebhookAllowInsecureLocal === true;

if (shouldVerify && rawBody && signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, this.config.stripeWebhookSecret);
}

if (allowInsecureLocal) {
  this.loggingService.warn(
    { event: "stripe.webhook_insecure_local_bypass_enabled" },
    StripeEventProcessorService.name,
  );
  return req.body as Stripe.Event;
}

throw new UnauthorizedException(
  "Stripe webhook signature could not be verified. " +
  "Ensure STRIPE_WEBHOOK_SECRET is configured.",
);
```
Recommended local flow remains `stripe listen --forward-to` (real signature). The flag is
only for temporary local debugging, never CI/staging/production.

**Config updates required:**
- `src/config/env.validation.ts`: add `STRIPE_WEBHOOK_ALLOW_INSECURE_LOCAL` (`true|false`, default `false`)
- `src/config/app.config.ts`: map `stripeWebhookAllowInsecureLocal: boolean`
- `.env.example`: document the flag with warning comment

**Files:** `src/payments/stripe-event-processor.service.ts`, `src/config/env.validation.ts`,
`src/config/app.config.ts`, `.env.example`

---

### A5 — Wrap raw `throw error` in typed errors

**Finding:** Two catch blocks re-throw untyped errors, meaning Prisma error objects (which
contain SQL query fragments and table names) can propagate up the call stack:
- `stripe-event-processor.service.ts:87` — inside `createEventRecord()`
- `payments.service.ts:263` — inside `handleStripeWebhook()`

The global exception filter sanitizes HTTP responses today, but Prisma internals in the
error chain are a liability if the filter is ever bypassed or modified.

**Fix:**
```typescript
// Replace bare: throw error
// With:
import { InternalServerErrorException } from "@nestjs/common";
throw new InternalServerErrorException("An unexpected error occurred.");
// Log the original error via loggingService before re-throwing.
```
Keep the `P2002` (unique constraint) guard in `createEventRecord` — that one is intentional
and should remain. Only replace the final un-typed `throw error`.

**Files:** `src/payments/stripe-event-processor.service.ts:87`, `src/payments/payments.service.ts:263`

---

## Phase B — Access Control

### B1 — Subscription gate at inbound boundaries

**Finding:** `TenantSubscription` table exists in the Prisma schema but nothing reads it.
Churned or expired tenants receive calls and SMS responses for free. This is both OWASP A01
(broken access control) and a revenue leak.

**Work:**
1. Add `getActiveTenantSubscription(tenantId: string)` to `TenantsService` and its interface
   (`src/tenants/interfaces/tenants-service.interface.ts`):
   ```typescript
   getActiveTenantSubscription(tenantId: string): Promise<TenantSubscription | null>;
   ```
   Active = `status IN ('ACTIVE', 'TRIALING') AND currentPeriodEnd > now()`.

2. Gate in `VoiceInboundUseCase` — after tenant resolution, before consent/stream logic:
   ```typescript
   // src/voice/voice-inbound.use-case.ts
   const subscription = await this.tenantsService.getActiveTenantSubscription(tenant.id);
   if (!subscription) {
     return this.voiceResponseService.replyWithGracefulHangup(
       res,
       "This service is not currently available. Goodbye.",
     );
   }
   ```

3. Gate in `SmsInboundUseCase` — same pattern after tenant resolution. Return a neutral SMS
   response (do not expose subscription status text to callers; use a generic "not available"
   message).

4. Add `replyWithGracefulHangup(res, message)` to `VoiceResponseService` if not already
   present (builds a `<Say><Hangup>` TwiML response).

**Files:**
- `src/tenants/interfaces/tenants-service.interface.ts`
- `src/tenants/tenants.service.ts` (implementation)
- `src/voice/voice-inbound.use-case.ts`
- `src/sms/sms-inbound.use-case.ts`
- `src/voice/voice-response.service.ts`

---

### B2 — Webhook body DTO boundary

**Finding:** `VoiceWebhookParserService` (`src/voice/voice-webhook-parser.service.ts`)
extracts fields directly from `req.body` using key lookups with no schema enforcement.
`SmsInboundUseCase` does the same for SMS body fields. Malformed or missing `CallSid`,
`SpeechResult`, or `From` values reach business logic as `null` and are handled
inconsistently across call sites.

**Work:**
1. Create `src/voice/dto/twilio-voice-webhook.dto.ts`:
   ```typescript
   export class TwilioVoiceWebhookDto {
     @IsString() @IsNotEmpty() CallSid: string;
     @IsString() @IsOptional() SpeechResult?: string;
     @IsString() @IsOptional() Confidence?: string;
     @IsString() @IsOptional() To?: string;
     @IsString() @IsOptional() From?: string;
   }
   ```

2. Create `src/sms/dto/twilio-sms-webhook.dto.ts`:
   ```typescript
   export class TwilioSmsWebhookDto {
     @IsString() @IsNotEmpty() From: string;
     @IsString() @IsOptional() Body?: string;
     @IsString() @IsOptional() SmsSid?: string;
   }
   ```

3. Update voice and SMS controller endpoints to accept the typed DTO as `@Body()`.
   Use endpoint-level `ValidationPipe` with `whitelist: true` and
   `forbidNonWhitelisted: false` for Twilio webhooks, because Twilio submits many
   additional form fields not modeled in the DTO.

4. Update `VoiceWebhookParserService` to accept `TwilioVoiceWebhookDto` instead of
   raw `Request`, eliminating the `req.body` key-lookup pattern.

**Note:** Twilio sends `application/x-www-form-urlencoded`. Confirm
`express.urlencoded({ extended: false })` (already in `main.ts:47`) is in place before
the controller — it is.

**Files:**
- New: `src/voice/dto/twilio-voice-webhook.dto.ts`
- New: `src/sms/dto/twilio-sms-webhook.dto.ts`
- `src/voice/voice-webhook-parser.service.ts`
- `src/voice/voice.controller.ts`
- `src/sms/sms.controller.ts`

---

## Phase C — Interface Segregation & Dependency Inversion

### C1 — `IConversationsService` interface + injection token

**Finding:** `ConversationsService` (`src/conversations/conversations.service.ts`, 131 lines)
is imported as a concrete class in ~29 non-test files across `voice/`, `ai/`, `sms/`, and
`payments/`. Every rename or signature change in the query layer cascades to all consumers.
`ConversationLifecycleService` has an interface token; `ConversationsService` does not.

**Work:**
1. Create `src/conversations/conversations.service.interface.ts`:
   - Define `CONVERSATIONS_SERVICE` injection token
   - Define `IConversationsService` interface with exactly the methods called by consumers
     (audit with `grep -n 'conversationsService\.' src/**/*.ts` to find the exact surface)

2. Add to `ConversationsModule`:
   ```typescript
   { provide: CONVERSATIONS_SERVICE, useExisting: ConversationsService }
   ```
   Export the token alongside the class.

3. Update all NestJS `@Injectable()` consumers to `@Inject(CONVERSATIONS_SERVICE)` +
   `IConversationsService` type. Plain-class runtimes: type annotation change only
   (same pattern as TODO-6 in REFACTOR3).

**Files:**
- New: `src/conversations/conversations.service.interface.ts`
- `src/conversations/conversations.module.ts`
- ~29 consumer files (NestJS services: `@Inject(TOKEN)`, plain runtimes: type annotation only)

---

### C2 — Split `IVoiceConversationStateService` by concern (ISP)

**Finding:** `IVoiceConversationStateService` has 16 methods
(`src/voice/voice-conversation-state.service.interface.ts`). Consumers like
`VoiceSmsPhoneSlotService` or `VoiceUrgencySlotService` use 1–2 methods but must declare
the full 16-method surface. This is a textbook ISP violation.

**Work — split into 5 focused interfaces:**

| Interface | Methods | Primary consumers |
|---|---|---|
| `IVoiceTranscriptState` | `updateVoiceTranscript` | stream gateway |
| `IVoiceNameSlot` | `updateVoiceNameState`, `promoteNameFromSms` | name-flow factory, SMS use-case |
| `IVoiceAddressSlot` | `updateVoiceAddressState`, `promoteAddressFromSms` | address-flow factory, SMS use-case |
| `IVoiceSmsSlot` | `updateVoiceSmsPhoneState`, `updateVoiceSmsHandoff`, `clearVoiceSmsHandoff` | SMS-handoff, phone-slot services |
| `IVoiceTurnOrchestration` | `incrementVoiceTurn`, `updateVoiceIssueCandidate`, `updateVoiceComfortRisk`, `updateVoiceUrgencyConfirmation`, `updateVoiceListeningWindow`, `clearVoiceListeningWindow`, `updateVoiceLastEventId`, `appendVoiceTurnTiming` | prelude runtime, triage factory |

**Implementation pattern:**
- Each interface gets its own `*-state.service.interface.ts` file and injection token
- `VoiceConversationStateService` implements all 5 interfaces (it is the concrete implementation)
- `ConversationsModule` provides all 5 tokens via `useExisting: VoiceConversationStateService`
- Consumers inject only the narrowest interface they need

**Files:**
- New: 5 `src/voice/interfaces/voice-*-slot.service.interface.ts` files (or co-located with
  each consuming service)
- `src/conversations/conversations.module.ts` (5 new `useExisting` providers + exports)
- All consumers: replace `IVoiceConversationStateService` with the narrowest applicable interface

---

### C3 — OCP: step registration via injection token (VoiceTurnStepFactory)

**Finding:** `VoiceTurnStepFactory.build()` (`src/voice/voice-turn-step.factory.ts`, 751 lines)
returns a hardcoded ordered array of 16 inline step closures. Adding a new step requires
modifying the factory file. The `IVoiceTurnStep` contract is open for extension but the
registration mechanism is closed to addition without modification — an OCP violation.

**Work:**
1. Define a `VOICE_TURN_STEP_REGISTRATIONS` injection token (array of step factories or
   ordered step descriptors with a `priority: number` field for deterministic ordering).

2. Each step registration becomes a `useFactory` provider in `VoiceModule`, accepting
   `VoiceTurnDependencies` and returning an `IVoiceTurnStep`. Steps are sorted by
   `priority` at pipeline construction time.

3. `VoiceTurnStepFactory` becomes a thin coordinator that sorts and delegates rather than
   constructing all step logic inline.

**Note:** Step ordering is safety-critical (prelude must run before context, context before
routing, etc.). Use explicit integer priorities (e.g., 100, 200, 300) with a gap between
steps so new steps can be inserted without renumbering.

**Files:**
- `src/voice/voice-turn-step.factory.ts` (reduce from 751 lines)
- `src/voice/voice.module.ts` (step providers)
- New: `src/voice/voice-turn-step.token.ts` (injection token + priority constants)

---

## Phase D — Service Decomposition (SRP)

### D1 — `AiService.triage()` → extract `TriageContextBuilder`

**Finding:** `AiService.triage()` (`src/ai/ai.service.ts:30–107`) performs 5 distinct
operations in a single method:
1. Input sanitization (lines 40–55)
2. Tenant context resolution (line 58)
3. Conversation lifecycle — create-or-fetch (lines 59–67)
4. Conversation history retrieval (lines 73–77)
5. Triage dispatch via `TriageOrchestratorService` (line 84)

Steps 3 and 4 are context assembly — separate concern from dispatch.

**Work:**
1. Create `src/ai/triage-context-builder.service.ts`:
   ```typescript
   interface TriageContext {
     tenantId: string;
     sessionId: string;
     conversationId: string;
     conversationHistory: AiChatMessageParam[];
     tenantContextPrompt: string;
     collectedData: Record<string, unknown> | null;
   }
   export class TriageContextBuilderService {
     async build(tenantId, sessionId, channel?, existingConversationId?): Promise<TriageContext>
   }
   ```

2. `AiService.triage()` becomes:
   ```typescript
   const context = await this.triageContextBuilder.build(tenantId, sessionId, options);
   return this.triageOrchestrator.run({ ...context, userMessage, incomingMessageLength });
   ```
   The method shrinks from ~80 lines to ~15.

3. `AiService` no longer needs `IConversationLifecycleService` or `ICallLogService` —
   those move to `TriageContextBuilderService`.

**Files:**
- New: `src/ai/triage-context-builder.service.ts`
- `src/ai/ai.service.ts` (remove lifecycle + history deps; inject TriageContextBuilder)
- `src/ai/ai.module.ts` (register new service)

---

### D2 — Split `PaymentsService.createCheckoutSessionFromIntake()`

**Finding:** `PaymentsService.createCheckoutSessionFromIntake()` (lines 73–205, ~130 lines)
performs 5 distinct operations:
1. Intake token decode + validation
2. Fee calculation via `IntakeFeeCalculatorService`
3. Stripe session creation
4. Job upsert (`ensureJobForConversation`)
5. Payment record upsert (`upsertPaymentForCheckout`)

**Work:**
1. Create `src/payments/intake-checkout-orchestrator.service.ts` that sequences the
   above steps, accepting each sub-service as a dependency.

2. `PaymentsService.createCheckoutSessionFromIntake()` becomes a single delegation call to
   `IntakeCheckoutOrchestratorService.run(params)`.

3. The private helpers `ensureJobForConversation` and `upsertPaymentForCheckout` move to
   the orchestrator or their respective domain services.

4. `PaymentsService` retains: `getIntakePageData`, `sendVoiceHandoffIntakeLink`,
   `handleStripeWebhook`. Stripe event processing stays in `StripeEventProcessorService`.

**Files:**
- New: `src/payments/intake-checkout-orchestrator.service.ts`
- `src/payments/payments.service.ts` (simplified)
- `src/payments/payments.module.ts` (register new service)

---

## Phase E — Module Boundary Cleanup & Observability

### E1 — Extract `AddressModule`

**Finding:** `AddressValidationService` (`src/address/address-validation.service.ts`) is on
the `arch-check.ts` allowlist as an "approved temporary seam." Voice services import it directly
rather than going through a module boundary. The arch-check script explicitly documents this
as a pending extraction.

**Work:**
1. Ensure `AddressValidationService` is provided and exported by a dedicated `AddressModule`
   (`src/address/address.module.ts`).
2. Create `src/address/address-validation.service.interface.ts` with an
   `IAddressValidationService` interface + `ADDRESS_VALIDATION_SERVICE` token.
3. Remove `src/address/address-validation.service.ts` from the `arch-check.ts`
   `MODULE_BOUNDARY_ALLOWED_TARGET_FILES` allowlist.
4. Update consumers to `@Inject(ADDRESS_VALIDATION_SERVICE)` + import `AddressModule`.

**Files:**
- New: `src/address/address.module.ts`
- New: `src/address/address-validation.service.interface.ts`
- `scripts/arch-check.ts` (remove allowlist entry)
- Consuming voice services

---

### E2 — Move `VoiceConversationStateService` to correct module

**Finding:** `VoiceConversationStateService` lives in `src/voice/` but is provided and
exported by `ConversationsModule` (`src/conversations/conversations.module.ts`). File
placement and module ownership are misaligned — a source of confusion and future import
drift. It is a state-persistence service for conversation collectedData, not a voice-domain
service.

**Work:**
- Move `src/voice/voice-conversation-state.service.ts` and
  `src/voice/voice-conversation-state.service.interface.ts` to
  `src/conversations/voice-conversation-state.service.ts` (its owning module's directory)
- Update all import paths accordingly
- No functional changes — pure file move

**Files:**
- `src/voice/voice-conversation-state.service.ts` → `src/conversations/`
- `src/voice/voice-conversation-state.service.interface.ts` → `src/conversations/`
- All import paths in voice runtimes and factories

---

### E3 — Admin audit interceptor

**Finding:** `AdminApiGuard` gates admin endpoints but no interceptor records who performed
what admin action. There is no audit trail for admin operations (tenant creation, fee policy
updates, etc.).

**Work:**
1. Create `src/common/interceptors/admin-audit.interceptor.ts`:
   - Implements `NestInterceptor`
   - Logs: timestamp, endpoint, HTTP method, IP, admin credential fingerprint
     (SHA-256 hash prefix; never raw or partial token),
     response status
   - Uses `LoggingService` (already global)

2. Apply to all admin-guarded controllers via `@UseInterceptors(AdminAuditInterceptor)`.

**Files:**
- New: `src/common/interceptors/admin-audit.interceptor.ts`
- Admin-facing controllers (tenants controller, etc.)

---

### E4 — Reduce `VoiceTurnDependencies` and `VoiceStreamDependencies`

**Finding:** Both classes are explicitly excepted from the constructor param gate:
- `VoiceTurnDependencies`: 21 params (DI-bag by design in REFACTOR3)
- `VoiceStreamDependencies`: 10 params

These are aggregator bags by necessity but their size indicates that the services they
assemble have not been fully decomposed. As Phase C work (interface splitting) proceeds,
revisit whether some params can be replaced with narrower interface injections, reducing
the bag size.

**Work:**
- After C2 (ISP split) is merged, audit which params in `VoiceTurnDependencies` can be
  replaced with the narrower `IVoiceNameSlot`, `IVoiceAddressSlot`, etc. interfaces
- Target state for exception removal: meet the existing constructor gate
  (`CONSTRUCTOR_PARAM_LIMIT = 8`) by extracting additional collaborators.
- Interim milestone: reduce materially first, keep exception with explicit rationale until
  the class can satisfy the gate without re-introducing a god-service.
- `VoiceStreamDependencies`: already 10 — evaluate after TODO-3 (REFACTOR3) is completed

**Files:** `src/voice/voice-turn.dependencies.ts`, `scripts/arch-check.ts`
**Depends on:** C2

---

## Priority Order

| # | ID | Item | Phase | Effort | Depends On |
|---|---|---|---|---|---|
| 1 | A1 | Axios SSRF + CI audit gate | A | 0.5 day | — |
| 2 | A2 | Helmet security headers | A | 0.5 day | — |
| 3 | A3 | Admin token timing-safe compare | A | 0.5 day | — |
| 4 | A4 | Stripe non-prod bypass fix | A | 0.5 day | — |
| 5 | A5 | Wrap raw throw errors | A | 0.5 day | — |
| 6 | B1 | Subscription gate (voice + SMS) | B | 2 days | — |
| 7 | B2 | Webhook body DTOs | B | 1 day | — |
| 8 | C1 | IConversationsService interface | C | 1 day | — |
| 9 | C2 | Split IVoiceConversationStateService | C | 2 days | C1 |
| 10 | C3 | OCP step registration token | C | 2 days | — |
| 11 | D1 | TriageContextBuilder extract | D | 1 day | C1 |
| 12 | D2 | PaymentsService checkout split | D | 2 days | — |
| 13 | E1 | AddressModule extraction | E | 1 day | — |
| 14 | E2 | Move VoiceConversationStateService file | E | 0.5 day | C2 |
| 15 | E3 | Admin audit interceptor | E | 1 day | A3 |
| 16 | E4 | Reduce dep bags | E | 1 day | C2 |

**Total estimated effort: ~18 days**

---

## Completion Checklist

- [x] A1  Axios critical SSRF patched; `npm audit` CI gate added
- [x] A2  `helmet()` in `main.ts`; security headers verified in response
- [x] A3  `timingSafeEqual` in `AdminApiGuard`
- [x] A4  Stripe non-prod fallback removed; fail-closed behavior verified
- [x] A5  Raw `throw error` replaced with typed `InternalServerErrorException`
- [x] B1  Subscription gate on `VoiceInboundUseCase` + `SmsInboundUseCase`
- [x] B2  `TwilioVoiceWebhookDto` + `TwilioSmsWebhookDto` on webhook endpoints
- [x] C1  `IConversationsService` + `CONVERSATIONS_SERVICE` token; ~29 consumers updated
- [x] C2  5 focused voice-state interfaces; consumers updated to narrowest applicable
- [x] C3  Step registration via injection token; `VoiceTurnStepFactory` simplified
- [ ] D1  `TriageContextBuilderService`; `AiService.triage()` ≤ 15 lines
- [ ] D2  `IntakeCheckoutOrchestratorService`; `createCheckoutSessionFromIntake` delegated
- [ ] E1  `AddressModule` with interface token; removed from arch-check allowlist
- [ ] E2  `VoiceConversationStateService` moved to `src/conversations/`
- [ ] E3  `AdminAuditInterceptor` on all admin-guarded endpoints
- [ ] E4  `VoiceTurnDependencies` reduced with clear rationale; exception removed only when
      class can satisfy constructor gate (≤8) without regressions

---

## Definition of Done

A TODO is **done** when ALL of the following are true:

| Criterion | What is checked |
|---|---|
| TypeScript compiles clean | `npx tsc --noEmit` — zero production-source errors |
| Architecture gates pass | `npm run arch:check` — all 6 gates green |
| No new security regressions | `npm audit --omit=dev` — zero critical severity |
| Tests still pass | `npm test` — no new failures |
| File placement matches module ownership | No cross-module concrete class imports outside allowlist |

---

## Architecture Notes

1. **Phase A is independent** — all five A items can be merged as a single PR.

2. **Phase B before Phase C** — subscription gating is a revenue/security gap that should
   be live before architectural refactors begin. B items are also standalone.

3. **C1 before C2** — `IConversationsService` gives C2 a complete picture of which services
   still hold concrete refs, making the ISP split cleaner.

4. **C2 before E2 and E4** — the file move (E2) should happen after the interface split
   so import paths only need updating once. Dep bag reduction (E4) depends on narrower
   interfaces from C2 being available.

5. **D1 after C1** — `TriageContextBuilderService` will inject `IConversationsService`,
   so C1 should be merged first.

6. **Do not touch `VoiceTurnPipeline` or `IVoiceTurnStep`** — the REFACTOR3 pipeline
   contract is stable. C3 adds a registration mechanism *on top of* the existing contract
   without changing the execution model.

7. **Stripe fix (A4) is fail-closed by default** — if signature verification cannot run,
   requests are rejected unless `NODE_ENV=development` and
   `STRIPE_WEBHOOK_ALLOW_INSECURE_LOCAL=true` are both set. Keep this flag `false` in
   test/CI/staging/production. Set `STRIPE_WEBHOOK_SECRET` in `.env.test` to keep tests
   deterministic.
