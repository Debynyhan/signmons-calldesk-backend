# Signmons CallDesk — Tasks & Sprint Plan (Single Source of Truth)

---

## Definition of Done (MVP)

> The MVP is complete **only** when all items below are checked.

* [ ] TenantOrganization created via Dev Auth (dev headers only when enabled)
* [ ] AI triage creates Customer, PropertyAddress, ServiceCategory, Job (tenant-scoped)
* [ ] Conversation visible with CommunicationEvent/Content (SMS, WEB, VOICE)
* [ ] Job visible with correct status, urgency, tenant isolation
* [ ] **Stripe payment succeeds BEFORE job confirmation**
* [ ] SMS/email/voice confirmation sent ONLY after payment success
* [ ] Voice/SMS consent language enforced before interaction
* [ ] End-to-end smoke test passes (AI → payment → job → SMS/VOICE)
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

---

### T-02.5 Voice Intake & AI Triage (P0)

#### Inbound Voice Plumbing

* [x] `/api/voice/inbound` webhook endpoint implemented
* [x] Tenant resolved by called phone number (`To`)
* [x] Voice disabled guard (`VOICE_ENABLED=false` returns safe TwiML)
* [x] Consent message played before any intake
* [x] Conversation created on first call event (`channel=VOICE`)
* [x] `requestId` generated and attached to conversation
* [x] Twilio Call SID captured and persisted

#### Caller Identity

* [x] Caller phone captured from `From`
* [x] Phone normalized to E.164
* [x] Customer created or reused by phone
* [x] Caller phone stored on Conversation metadata

#### Speech → Text Intake

* [x] Twilio `<Gather input="speech">` configured
* [x] `/api/voice/turn` endpoint implemented
* [x] Transcript extracted from `SpeechResult`
* [x] Confidence score captured when provided

#### Conversation Persistence

* [x] Transcript stored as `CommunicationContent`

  * role = USER
  * channel = VOICE
* [x] Voice turns appended in chronological order
* [x] No audio blobs stored (text only)

#### AI Execution

* [x] Voice transcripts routed through existing AI pipeline
* [x] Same schema validation, budgets, retries enforced
* [x] Tool calls allowed from VOICE channel
* [x] AI responses persisted as `CommunicationContent` (ASSISTANT)

#### Voice Output

* [x] AI responses converted to `<Say>`
* [x] Follow-up `<Gather>` issued when FSM requires more input
* [x] Call ends cleanly on job creation or refusal

#### Safety & Observability

* [x] AI refusal detected on voice path
* [x] Voice refusal logged with tenantId, conversationId, model, reason
* [x] Fallback logged when preview model fails
* [x] Voice interaction capped (max turns / timeout)

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
  - [ ] “I heard Dean Banks. Is that correct?”
- [ ] Accept only explicit confirmation (yes / correct)
- [ ] On rejection:
  - [ ] Clear name field
  - [ ] Re-ask for name
- [ ] Lock name after confirmation

**Acceptance Criteria**

- [ ] `confirmedName` is written only after explicit yes/correct confirmation
- [ ] `confirmedName` is immutable once set
- [ ] `fieldConfirmations` entry exists for `name` with `confirmedAt` + `sourceEventId`
- [ ] Test coverage includes rejection → re-ask → success path

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
  - [ ] “I have 20991 Reach Your A… That seems incomplete. Can you repeat the full street name?”
- [ ] Block job creation until address is confirmed

**Rules**

- [ ] `VOICE_ADDRESS_MIN_CONFIDENCE` required (env-configurable, fail closed below threshold)
- [ ] If confidence < `VOICE_ADDRESS_MIN_CONFIDENCE` → clarification loop
- [ ] If repeated ambiguity (>= 2 attempts) → safe escalation (human or SMS follow-up)
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

- [ ] Same utterance never processed twice
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

- [ ] No confirmed name → no job creation
- [ ] No confirmed address → no job creation
- [ ] Conflicting data → clarification loop
- [ ] AI uncertainty → ask again, never assume

**Acceptance Criteria**

- [ ] No canonical records are created without confirmed name + address
- [ ] Tests prove fail-closed behavior

#### T-V07 — Voice E2E Integrity Tests (P0)

**Description**
Protect voice flows against regression and hallucination.

**Test Scenarios**

- [ ] Misheard name → correction → confirmation
- [ ] Partial address → clarification → success
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

* [x] Job lifecycle enforced: CREATED → ACCEPTED
* [x] issueCategory → ServiceCategory mapping verified
* [ ] Address normalization placeholder (dev-safe)
* [ ] Address validation via Google Places (prod only)
* [ ] Service-area coverage enforced
* [ ] Invalid/uncovered address fails closed
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

### T-05 Confirmation & Messaging (Twilio SMS) (P0)

* [ ] SMS sent only after job creation
* [ ] Tenant-branded copy
* [ ] No sensitive payment data in messages
* [ ] SMS failure does not roll back payment/job
* [ ] Observability: tenantId, paymentIntentId, jobId, SMS SID
* [ ] Twilio dry-run enabled in dev

---

### T-06 Admin & UI (P1)

* [ ] Admin dashboard shell (Signmons internal)
* [ ] TenantOrganization create/edit UI
* [ ] Tenant user list + role management
* [ ] ServiceCategory list/edit UI
* [ ] Provider toggles (AI, SMS, Voice, Address)
* [ ] Conversations timeline UI (SMS/WEB/VOICE)
* [ ] Jobs list + job detail view
* [ ] Payment badge + status indicators
* [ ] UX polish (loading, retries, inline errors, dev banner)

---

### T-07 QA & Smoke (P0)

* [ ] `scripts/smoke-test.sh` passes
* [ ] AI → payment → job → SMS validated
* [ ] AI → payment → job → VOICE validated
* [ ] Cross-tenant scenarios tested
* [ ] Providers disabled by default in dev verified

---

### T-08 Voice Provider (Twilio Voice) (P0)

* [ ] Twilio account configured
* [ ] Voice phone number purchased
* [ ] Voice webhook URLs registered
* [ ] Tenant ↔ phone number mapping table implemented
* [ ] Consent message script finalized
* [ ] Call SID logged on all voice events
* [ ] Call recording disabled by default
* [ ] Voice provider hard-disabled in dev
* [ ] Graceful failure message when provider unavailable

---

### T-09 Media Uploads (P0)

* [ ] GCS buckets per environment
* [ ] Signed URL upload endpoint
* [ ] Tenant/job-scoped object paths
* [ ] MIME type allowlist enforced
* [ ] File size limits enforced
* [ ] Virus scan placeholder (future hook)
* [ ] Media metadata stored (no blobs in DB)
* [ ] Media uploads disabled by default in dev

---

### Provider Governance (P0)

* [ ] AI disabled by default in dev
* [ ] SMS disabled by default in dev
* [ ] Voice disabled by default in dev
* [ ] Address validation disabled by default in dev
* [ ] Media uploads disabled by default in dev
* [ ] Provider failures do not corrupt core data
* [ ] Provider errors logged with tenantId + requestId

---

## Sprint Plan (REFERENCES TASK IDS — NO DUPLICATION)

### Sprint 1 — Security Foundations

**Tasks:** T-01
**Exit:** Cross-tenant access impossible

### Sprint 2 — AI Reliability & Job Integrity

**Tasks:** T-02, T-02.5, T-02.6, T-03
**Exit:** AI safely triages via text or voice with voice-grade data integrity guarantees

### Sprint 3 — Revenue Lock-In

**Tasks:** T-04, T-05, T-08
**Exit:** No unpaid job can exist

### Sprint 4 — MVP Polish & Demo Readiness

**Tasks:** T-06, T-07, T-09
**Exit:** Demo-ready MVP

---

## Global Principle

> **If a task is not in the Canonical Task Board, it does not exist.**
