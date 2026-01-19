# Signmons CallDesk — Tasks & Sprint Plan (Single Source of Truth)

---

## Definition of Done (MVP)

> The MVP is complete **only** when all items below are checked.

* [ ] TenantOrganization created via Dev Auth (dev headers only when enabled)
* [ ] AI triage creates Customer, PropertyAddress, ServiceCategory, Job (tenant-scoped)
* [ ] Conversation visible with CommunicationEvent/Content
* [ ] Job visible with correct status, urgency, tenant isolation
* [ ] **Stripe payment succeeds BEFORE job confirmation**
* [ ] SMS/email confirmation sent ONLY after payment success
* [ ] End-to-end smoke test passes (AI → payment → job → SMS)
* [ ] Multi-tenant isolation enforced on all reads/writes
* [ ] External providers disabled by default in dev

---

## Canonical Task Board (TRACK PROGRESS HERE ONLY)

### T-01 Multi-Tenant Isolation (P0)

* [x] JWT auth claims are authoritative tenant source
* [x] Request body tenantId ignored everywhere
* [x] Header validated vs claims (prod)
* [x] `x-dev-tenant-id` allowed only with `DEV_AUTH_ENABLED=true`
* [x] Request-scoped tenant context `{ tenantId, userId, role, requestId }`
* [x] TenantGuard enforced after AuthGuard
* [x] Prisma queries scoped by tenantId (Jobs, Conversations, Customers, Communication, ServiceCategory)
* [x] Cross-tenant tests (read/write/infer blocked)
* [x] Tenant isolation documented (dev vs prod rules)

---

### T-02 AI Safety & Conversation Integrity (P0)

* [x] Conversation created per session (channel, status, FSM state)
* [x] Conversation ↔ Job linking
* [x] AI output schema validation (fail closed)
* [x] Tool argument validation + normalization
* [x] AI budgets (tokens, retries, timeouts)
* [x] AI refusal + fallback logging

### T-02.6 Voice-Grade Data Integrity (P0)

**Objective**
Deliver a first-class, award-quality AI voice experience that captures accurate customer identity and service details, is interruption-safe, and never persists unconfirmed or low-confidence data. This section defines non-negotiable intake guarantees for Signmons Voice.

**Data Contract**

- [ ] `Conversation.collectedData.candidateName` / `candidateAddress` are untrusted (captured from speech, never persisted to canonical records)
- [ ] `Conversation.collectedData.confirmedName` / `confirmedAddress` are trusted (persisted only after explicit confirmation)
- [ ] `Conversation.collectedData.fieldConfirmations` is required and must include:
  - [ ] `field` (e.g., `name`, `address`)
  - [ ] `confirmedAt` (ISO timestamp)
  - [ ] `sourceEventId` (CommunicationEvent ID that triggered confirmation)
- [ ] `CommunicationContent.payload` must always retain `transcript` + `confidence` as the audit trail

#### T-V01 — Canonical Name Capture & Confirmation (P0)

**Description**
Capture customer name via voice in a way that matches professional call center standards.

**Requirements**

- [ ] Extract candidate name from speech using AI
- [ ] Normalize (capitalize, strip filler words)
- [ ] Do not persist immediately
- [ ] Read back explicitly for confirmation:
  - [ ] "I heard Dean Banks. Is that correct?"
- [ ] Accept only explicit confirmation (yes / correct)
- [ ] On rejection:
  - [ ] Clear name field
  - [ ] Re-ask for name
- [ ] Lock name after confirmation

**Acceptance Criteria**

- [ ] `confirmedName` is written only after explicit yes/correct confirmation
- [ ] `confirmedName` is immutable once set
- [ ] `fieldConfirmations` entry exists for `name` with `confirmedAt` + `sourceEventId`
- [ ] Test coverage includes rejection -> re-ask -> success path

#### T-V02 — Address Capture with Verification Loop (P0)

**Description**
Ensure service address accuracy under noisy, partial, or ambiguous voice input.

**Requirements**

- [ ] Address capture is multi-phase:
  - [ ] Raw speech capture
  - [ ] AI extraction
  - [ ] Normalization / parsing
  - [ ] Read-back confirmation
- [ ] Never guess or autocomplete street names
- [ ] Detect low-confidence or partial addresses
- [ ] Structured confirmation prompt:
  - [ ] "I have 20991 Reach Your A... That seems incomplete. Can you repeat the full street name?"
- [ ] Block job creation until address is confirmed

**Rules**

- [ ] `VOICE_ADDRESS_MIN_CONFIDENCE` required (env-configurable, fail closed below threshold)
- [ ] If confidence < `VOICE_ADDRESS_MIN_CONFIDENCE` -> clarification loop
- [ ] If repeated ambiguity (>= 2 attempts) -> safe escalation (human or SMS follow-up)
- [ ] Address persistence only after explicit confirmation
- [ ] Google Places may validate/normalize only after explicit confirmation (no guessing)

**Acceptance Criteria**

- [ ] `confirmedAddress` is written only after explicit confirmation
- [ ] `fieldConfirmations` entry exists for `address` with `confirmedAt` + `sourceEventId`
- [ ] Places validation runs only after confirmation
- [ ] FSM blocks downstream actions without confirmed address

#### T-V03 — Interruption-Safe Voice Turn Handling (P0)

**Description**
Prevent double-capture, corrupted state, or skipped confirmations during user interruptions.

**Requirements**

- [ ] Each prompt defines an explicit `listening_window`
- [ ] On user barge-in:
  - [ ] Stop audio playback
  - [ ] Route speech only to the expected field
- [ ] Ignore irrelevant speech during confirmation prompts
- [ ] Enforce idempotency per voice turn

**Acceptance Criteria**

- [ ] Same utterance never processed twice (idempotent per voice turn)
- [ ] Interruptions do not bypass confirmation steps
- [ ] FSM state remains deterministic across interruptions

#### T-V04 — Voice Interaction Policy Layer (P0)

**Description**
Introduce a voice-specific policy layer that wraps the FSM without replacing it.

**Responsibilities**

- [ ] Enforce confirmation requirements
- [ ] Manage turn limits and duration limits
- [ ] Handle polite clarification and recovery
- [ ] Determine safe hang-up conditions

**Notes**

* FSM remains the system of record
* Voice layer acts as a constraint and guardrail, not a decision engine

#### T-V05 — Neural Voice Output via Google TTS (P0)

**Description**
Replace robotic speech with high-quality neural voice output.

**Requirements**

- [ ] Use Google Cloud Neural2 Text-to-Speech
- [ ] Generate audio via SSML:
  - [ ] Natural pauses (`<break>`)
  - [ ] Emphasis for names, numbers, addresses
- [ ] Deliver audio via Twilio `<Play>` (not `<Say>`)
- [ ] Cache repeated prompts where applicable
- [ ] Implement adapter + config + feature flag
- [ ] Enable Neural2 voices only when `VOICE_TTS_PROVIDER=google` and `VOICE_ENABLED=true`
- [ ] Twilio `<Say>` remains the dev fallback

**Acceptance Criteria**

- [ ] No `<Say>` in production voice paths when Neural2 is enabled
- [ ] Voice output is natural and brand-consistent
- [ ] p95 voice response latency target documented (placeholder, measure in MVP)

#### T-V06 — Fail-Closed Intake Guarantees (P0)

**Description**
Ensure the system fails safely rather than guessing.

**Rules**

- [ ] No confirmed name -> no job creation
- [ ] No confirmed address -> no job creation
- [ ] Conflicting data -> clarification loop
- [ ] AI uncertainty -> ask again, never assume

**Acceptance Criteria**

- [ ] No canonical records are created without confirmed name + address
- [ ] Tests prove fail-closed behavior

#### T-V07 — Voice E2E Integrity Tests (P0)

**Description**
Protect voice flows against regression and hallucination.

**Test Scenarios**

- [ ] Misheard name -> correction -> confirmation
- [ ] Partial address -> clarification -> success
- [ ] User interrupts confirmation read-back
- [ ] Silence or no response
- [ ] AI hallucinated data (must be rejected)

**Acceptance Criteria**

- [ ] All tests pass in CI
- [ ] No unconfirmed data reaches persistence layer

#### T-V08 — Voice Cost & Quality Telemetry (P1)

**Description**
Track voice performance and costs during MVP.

**Metrics**

- [ ] STT duration (seconds)
- [ ] TTS characters generated
- [ ] Call duration
- [ ] Average turns per call
- [ ] Clarification count per field

**Acceptance Criteria**

- [ ] Metrics available per tenant and per call
- [ ] Enables cost tuning and UX improvement

#### T-V09 — Speech-to-Text Provider (P1)

**Description**
Introduce Google Speech-to-Text for premium accuracy while preserving Twilio `<Gather>` as the default MVP path.

**Requirements**

- [ ] Provider flag: `VOICE_STT_PROVIDER=twilio|google` (default `twilio`)
- [ ] Google STT enabled only when `VOICE_STT_PROVIDER=google` and `VOICE_ENABLED=true`
- [ ] Twilio STT remains the fallback if Google STT fails
- [ ] Audio ingestion pipeline exists only when Google STT is enabled
- [ ] Tenant-scoped toggle (future-ready)

**Acceptance Criteria**

- [ ] Default path uses Twilio STT (no behavior change when flag is unset)
- [ ] Google STT path produces transcripts with confidence score
- [ ] Fallback to Twilio STT on Google failure
- [ ] Cost telemetry recorded per call (STT seconds + cost estimate)

**Design Principle (Non-Negotiable)**

Voice is a hostile input channel.
No critical data is trusted without explicit user confirmation.
FSM remains the source of truth.

---

### T-03 Job Lifecycle & Data Integrity (P0)

* [ ] Job lifecycle enforced: CREATED → ACCEPTED
* [ ] issueCategory → ServiceCategory mapping verified
* [ ] Address normalization placeholder (dev-safe)
* [ ] Job creation idempotent
* [ ] Audit trail includes tenantId everywhere

---

### T-04 Payment-First Booking (Stripe) (P0)

* [ ] Diagnostic fee required before booking
* [ ] Emergency vs non-emergency pricing explicit
* [ ] Stripe test-mode Payment Intent created
* [ ] Payment metadata includes tenantId, sessionId, urgency
* [ ] Customer consent captured before payment
* [ ] Payment verification via webhook
* [ ] Job confirmation only after `payment_intent.succeeded`
* [ ] Duplicate attempts idempotent
* [ ] Payment ↔ Job linkage persisted

---

### T-05 Confirmation & Messaging (Twilio) (P0)

* [ ] SMS sent only after job creation
* [ ] Tenant-branded copy
* [ ] No sensitive payment data in messages
* [ ] SMS failure does not roll back payment/job
* [ ] Observability: tenantId, paymentIntentId, jobId, SMS SID
* [ ] Twilio dry-run enabled in dev

---

### T-06 Admin & UI (P1)

* [ ] Admin panel: tenant settings
* [ ] ServiceCategory list/edit
* [ ] Tool toggles per tenant
* [ ] Conversations timeline UI
* [ ] Jobs list + detail view with payment badge
* [ ] UX polish (loading, retries, inline errors, dev banner)

---

### T-07 QA & Smoke (P0)

* [ ] `scripts/smoke-test.sh` passes
* [ ] AI triage → payment → job → SMS validated
* [ ] Cross-tenant scenarios tested
* [ ] Providers disabled by default in dev

---

## Sprint Plan (REFERENCES TASK IDS — NO DUPLICATION)

### Sprint 1 — Security Foundations

**Tasks:** T-01
**Exit:** Cross-tenant access impossible, tests pass

---

### Sprint 2 — AI Reliability & Job Integrity

**Tasks:** T-02, T-02.6, T-03
**Exit:** AI safely creates jobs with voice-grade data integrity guarantees

---

### Sprint 3 — Revenue Lock-In

**Tasks:** T-04, T-05
**Exit:** No unpaid job can exist; payment → job → SMS traceable

---

### Sprint 4 — MVP Polish & Demo Readiness

**Tasks:** T-06, T-07
**Exit:** Full MVP DoD satisfied, demo-ready

---

## Post-MVP (Award-Winning Track)

* AI policy guard + deterministic orchestration
* Structured AI observability (cost, latency, prompt versions)
* PII redaction + retention policies
* ServiceArea + coverage checks
* Human override + AI feedback capture
* Stripe Connect onboarding
* Billing portal + invoices
* Dunning & retry flows
* Revenue analytics (ARR, churn)
* In-app onboarding checklist

---

## Global Principle

> **If a task is not in the Canonical Task Board, it does not exist.**
> Sprints only reference tasks — they never redefine them.
