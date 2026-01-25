# Signmons CallDesk — Tasks Checklist (Single Source of Truth)

Specs and references: docs/voice/voice-intake.md, docs/voice/voice-grade-integrity.md, docs/roadmap.md

---

## Definition of Done (MVP) — Authoritative

 The MVP is complete only when all items below are true in   production-equivalent conditions.
 If any item is false, the system is not shippable.

## 🏢 Tenant & Security Foundations

 - [] TenantOrganization can be created only via Dev Auth when DEV_AUTH_ENABLED=true

 - [] JWT auth claims are the sole authoritative tenant source in non-dev environments

 - [] Multi-tenant isolation enforced on all reads, writes, and inferences

 - [] Request body tenantId is ignored everywhere

 - [] Cross-tenant access is provably impossible (tests pass)

## 🧠 AI CSR & Conversation Integrity

 - [] AI CSR operates as a policy-driven dispatcher, not a free-form chatbot

 - [] Conversation is created per session with:

channel = SMS | WEB | VOICE

deterministic FSM state

 - [] All user and assistant turns persist as CommunicationEvent + CommunicationContent

 - [] AI output is schema-validated and fails closed

 - [] AI never persists inferred facts without explicit confirmation

## 📞 Voice Channel (Persuasion-Only by Design)

 - [] Voice intake captures candidate name, address, and issue only

 - [] Voice confirmations are non-canonical and marked provisional

 - [] Voice never creates or confirms a job

 - [] Voice success is defined as:

    - [] Clean SMS handoff or

    - [] Human fallback (safe escalation)

 - [] Duplicate utterances, interruptions, and low-confidence input do not corrupt FSM state

 - [] Voice interaction enforces consent language before intake

## 📲 SMS Channel (Canonical Authority)

 - [] SMS is the single canonical confirmation channel for:

    - []customer name

    - [] service address

    - [] service fee

 - [] SMS confirmation is required to:

    - [] lock identity data

    - [] advance FSM beyond intake

 - [] SMS links are tenant-branded and session-scoped

 - [] SMS confirmation is auditable and idempotent

## 💳 Payment-First Booking (Hard Gate)

 - [] Stripe Payment Intent is created before job confirmation

 - [] Diagnostic / service fee is explicitly disclosed and consented

 - [] Payment metadata includes tenantId, conversationId, urgency

 - [] Job cannot transition to confirmed/accepted without:

    - [] SMS-confirmed data

    - [] payment_intent.succeeded

 - [] Payment verification occurs via webhook, not client trust

## 🧾 Job & Data Creation Guarantees

 - [] AI triage creates:

    - [] Customer

    - [] PropertyAddress

    - []ServiceCategory

    - [] Job
only after canonical confirmation + payment

 - [] Job has correct:

    - [] urgency

    - [] status

    - [] tenant isolation

 - [] Job creation is idempotent

 - [] No canonical record exists with unconfirmed name or address

## ✉️ Confirmation & Messaging

 - [] SMS/email/voice confirmations are sent only after payment success

 - [] Messages contain no sensitive payment data

 - [] Messaging failures do not roll back job or payment

 - [] All messages are tenant-branded and traceable

## 🧪 QA, Observability & Safety

 - [] End-to-end smoke test passes:

    - [] AI → voice → SMS → payment → job → confirmation

 - [] Provider failures (AI, Voice, SMS, Stripe) do not corrupt core data

 - [] AI refusals, fallbacks, and human escalations are logged with tenantId + requestId

 - [] External providers are disabled by default in dev

## 🏁 Final MVP Assertion (Non-Negotiable)

A job exists only if:

The customer confirmed via SMS

Payment succeeded

FSM advanced deterministically

Tenant isolation is intact

If any one of those is false, the system must fail closed.

---

## Canonical Task Board (TRACK PROGRESS HERE ONLY)

### T-01 Multi-Tenant Isolation (P0)

- [x] JWT auth claims are authoritative tenant source
- [x] Request body tenantId ignored everywhere
- [x] Header validated vs claims (prod)
- [x] `x-dev-tenant-id` allowed only with `DEV_AUTH_ENABLED=true`
- [x] Request-scoped tenant context `{ tenantId, userId, role, requestId }`
- [x] TenantGuard enforced after AuthGuard
- [x] Prisma queries scoped by tenantId (Jobs, Conversations, Customers, Communication, ServiceCategory)
- [x] Cross-tenant tests (read/write/infer blocked)
- [x] Tenant isolation documented (dev vs prod rules)

---

### T-02 AI Safety & Conversation Integrity (P0)

- [x] Conversation created per session (channel, status, FSM state)
- [x] Conversation ↔ Job linking
- [x] AI output schema validation (fail closed)
- [x] Tool argument validation + normalization
- [x] AI budgets (tokens, retries, timeouts)
- [x] AI refusal + fallback logging

---

### T-02.5 Voice Intake & AI Triage (P0)

#### Inbound Voice Plumbing

- [x] `/api/voice/inbound` webhook endpoint implemented
- [x] Tenant resolved by called phone number (`To`)
- [x] Voice disabled guard (`VOICE_ENABLED=false` returns safe TwiML)
- [x] Consent message played before any intake
- [x] Conversation created on first call event (`channel=VOICE`)
- [ ] `requestId` generated and attached to conversation
- [x] Twilio Call SID captured and persisted

#### Caller Identity

- [x] Caller phone captured from `From`
- [x] Phone normalized to E.164
- [x] Customer created or reused by phone
- [x] Caller phone stored on Conversation metadata

#### Speech → Text Intake

- [x] Twilio `<Gather input="speech">` configured
- [x] `/api/voice/turn` endpoint implemented
- [x] Transcript extracted from `SpeechResult`
- [x] Confidence score captured when provided

#### Conversation Persistence

- [x] Transcript stored as `CommunicationContent`
- [x] Voice turns appended in chronological order
- [x] No audio blobs stored (text only)

#### AI Execution

- [x] Voice transcripts routed through existing AI pipeline
- [x] Same schema validation, budgets, retries enforced
- [x] Voice AI tool calls are classification-only (no job creation in voice)
- [x] AI responses persisted as `CommunicationContent` (ASSISTANT)

#### Voice Output

- [x] AI responses converted to `<Say>`
- [x] Follow-up `<Gather>` issued when FSM requires more input
- [ ] Call ends cleanly on SMS handoff, human fallback, or refusal

#### Safety & Observability

- [x] AI refusal detected on voice path
- [x] Voice refusal logged with tenantId, conversationId, model, reason
- [x] Fallback logged when preview model fails
- [x] Voice interaction capped (max turns / timeout)

### T-02.6 Voice-Grade Data Integrity (P0)

#### Principles (P0)

- [ ] Conversation is flexible; decisions are not
- [ ] Tone adapts; rules do not
- [ ] Data is never trusted until confirmed
- [ ] AI CSR may infer intent but never facts
- [ ] FSM / Data Integrity is the only state-mutation layer
- [ ] CSR layer is delivery only (no state mutation)
- [ ] Tenant Business Policy is explicit (not prompt-only)

#### Authority & Outcomes (P0)

- [ ] SMS confirmation is canonical for name/address/payment
- [x] Voice confirmation is provisional only (candidate lock, no canonical write)
- [ ] Voice is for momentum and intent capture; SMS is for accuracy and commitment
- [ ] FSM enforces: no job creation until SMS-confirmed name + address and Stripe payment
- [ ] Voice outcomes are explicit and logged: SMS handoff (success), human fallback (controlled failure), call ends without handoff (true failure)

#### SLOs (MVP Targets)

- [ ] SLOs defined and tracked (see docs/voice/voice-grade-integrity.md#slos)

#### Enhancements & Gaps (Recommended)

- [ ] Spelling fallback for low-confidence names (letter-by-letter capture + confirm)
- [ ] Address components capture (street/city/zip) with explicit zip confirmation
- [ ] Prompt/script versioning with A/B tags for measurable CSR iteration
- [ ] Tenant-specific vocabulary hints (names, neighborhoods) to improve STT accuracy

#### Data Contract

- [x] `Conversation.collectedData.name` is structured (candidate/confirmed/status/locked/attemptCount)
- [x] `Conversation.collectedData.address` mirrors `name` with the same structure
- [x] `confirmed` values are SMS-only; voice writes candidates and provisional status only
- [x] `Conversation.collectedData.fieldConfirmations` is append-only and includes:
  - [x] `field` (`name` | `address`)
  - [x] `value`
  - [x] `confirmedAt` (ISO timestamp)
  - [x] `sourceEventId` (CommunicationEvent ID that triggered confirmation)
  - [ ] `channel` (`VOICE` | `SMS` | `WEB`)
- [ ] `fieldConfirmations` supports SMS/payment confirmations (`sms_confirmed`, `payment_confirmed`)
- [x] `CommunicationContent.payload` must always retain `transcript` + `confidence` as the audit trail

#### Core Intake (P0)

##### T-V01 — Canonical Name Capture & Confirmation



- [x] Extract candidate name from speech using AI
- [x] Normalize (capitalize, strip filler words)
- [x] Do not persist immediately
- [x] Read back explicitly for confirmation
- [x] Accept only explicit confirmation (yes / correct)
- [x] On rejection: clear candidate + re-ask
- [x] Lock candidate after voice confirmation (provisional only)
- [x] SMS confirmation required before canonical name is written


- [x] Voice rejection → re-ask → success path is covered
- [x] Voice confirmation updates candidate only (no canonical write)
- [x] `confirmedName` is set only after SMS confirmation (channel=SMS)
- [x] `confirmedName` is immutable once set
- [x] `fieldConfirmations` includes SMS entry for `name` with `confirmedAt` + `sourceEventId`
- [ ] Job/payment gates read only SMS-confirmed name

##### T-V02 — Address Capture with Verification Loop



- [x] Address capture is multi-phase (raw → extract → normalize → confirm)
- [x] Never guess or autocomplete street names
- [x] Detect low-confidence or partial addresses
- [x] Structured confirmation prompt for incomplete input
- [ ] Block job creation until SMS-confirmed address


- [x] `VOICE_ADDRESS_MIN_CONFIDENCE` required (env-configurable, fail closed below threshold)
- [x] If confidence < threshold → clarification loop
- [x] If repeated ambiguity (>= 2 attempts) → safe escalation (human or SMS follow-up)
- [x] Address persistence only after SMS confirmation
- [ ] Google Places may validate/normalize only after SMS confirmation (no guessing)


- [x] Incomplete/low-confidence addresses do not become canonical
- [x] Voice confirmation updates candidate only (no canonical write)
- [x] `confirmedAddress` is set only after SMS confirmation (channel=SMS)
- [x] `fieldConfirmations` includes SMS entry for `address` with `confirmedAt` + `sourceEventId`
- [ ] Places validation runs only after SMS confirmation
- [ ] FSM blocks downstream actions without SMS-confirmed address

#### Confirmation & Corrections (P0)

##### T-V10 — Content-First Confirmation Resolver


 - [x] Create `resolveConfirmation(utterance, currentCandidate, fieldType)`
 - [x] Return one of: `CONFIRM | REPLACE_CANDIDATE | REJECT | UNKNOWN`
 - [x] Apply deterministic rules in order (confirm → reject → replace → unknown)

##### T-V11 — Field Validation Heuristics



- [x] Name valid if: 2–3 tokens, alphabetic, not stopwords
- [x] Address valid if: passes `isIncompleteAddress` (fail closed)
- [x] No Places API or fuzzy guessing in this layer

##### T-V12 — Prompt Softening



- [x] Name confirm prompt: “I heard {name}. If that’s right, say ‘yes’. Otherwise, say your full name again.”
- [x] Address confirm prompt: “I heard {address}. If that’s right, say ‘yes’. Otherwise, say the full address again.”
- [x] Unknown reprompt: “Sorry, I didn’t catch that. You can say ‘yes’, ‘no’, or tell me the correct details.”

##### T-V13 — FSM Safety Guards



- [x] Confirmed fields are immutable
 - [x] `attemptCount` increments on REJECT or REPLACE_CANDIDATE
- [x] Max attempts trigger existing SMS/human fallback

##### T-V14 — Confirmation Resolver Tests



- [x] “No, it’s Ben Banks” → REPLACE_CANDIDATE → confirm flow
- [x] “Correct” confirms
- [x] Confirmed fields cannot be overwritten
- [x] Incomplete address still fails closed

#### Turn Handling & Momentum (P0)

##### T-V03 — Interruption-Safe Voice Turn Handling



- [x] Each prompt defines an explicit `listening_window`
- [x] On user barge-in: stop playback + route speech only to expected field
- [x] Ignore irrelevant speech during confirmation prompts
- [x] Enforce idempotency per voice turn


- [x] Same utterance never processed twice
- [x] Interruptions do not bypass confirmation steps
- [x] FSM state remains deterministic across interruptions

##### T-V17 — Conversational Momentum & Fatigue Guard



- [ ] Track last N confirmation prompts
- [ ] No more than 2 binary confirmations in a row
- [ ] After binary confirmation: next prompt is guided or open-ended


- [ ] Reduced yes/no loops
- [ ] Improved conversational flow
- [ ] FSM guarantees preserved

##### T-V18 — Duplicate Utterance Suppression



- [x] Detect identical transcripts within <= 2s window
- [x] Ignore duplicate utterance safely
- [x] No state mutation on ignored turns


- [x] Duplicate speech never advances FSM
- [x] No double confirmations
- [x] Voice feels smoother and less “confused”

##### T-V19 — Confidence-Based Soft Confirmation



- [x] If STT confidence >= threshold and heuristics pass and user repeats value
- [x] Use soft confirmation phrasing (“Great, I’ve got {value}. ”)
- [x] Lock field only after confirmation resolver passes


- [x] Fewer explicit “yes/no” prompts
- [x] No unconfirmed data persisted
- [x] Improved human-like pacing

#### CSR Strategy & Script Layer (P0)

##### T-V15 — CSR Strategy Selector



- [x] Analyze FSM state + collectedData completeness
- [x] Select CSR mode: OPENING, EMPATHY, CONFIRMATION, URGENCY_FRAMING, NEXT_STEP_POSITIONING
- [ ] Apply AIDA for flow and SERVQUAL for tone (internal only)
- [ ] Use Challenger (light) for urgency framing without yes/no questions
- [ ] Frameworks are encoded, never exposed to users
- [x] Never bypass FSM-required confirmations
- [x] Never persist data in this layer


- [ ] Same FSM path produces more natural phrasing
- [ ] No regression in confirmation guarantees
- [x] CSR layer is testable in isolation

##### T-V16 — Sales Script Engine (Composable, Tenant-Safe)



- [ ] Define `CSRScript` interface (opening/empathy/urgency/value/paymentTransition/close)
- [ ] Scripts selected by emergency vs non-emergency and channel=VOICE
- [ ] Light randomization to avoid repetition
- [ ] No hard-coded scripts in controllers


- [ ] Conversations feel guided, not interrogative
- [ ] Emergency framing is confident, not a question
- [ ] Payment transitions feel natural

##### T-V20 — CSR Voice Personality Guardrails


- [ ] Never ask for information already confirmed
- [ ] Never apologize excessively
- [ ] Never expose internal uncertainty
- [ ] Always frame next steps confidently
- [ ] Treat confirmation variants (correct/yes/yep/that's right) as CONFIRM
- [ ] Treat corrected content as REPLACE_CANDIDATE (no yes/no trap)
- [ ] Avoid rambling or free-form chat; keep prompts short and purposeful
- [ ] Acknowledge emotion, infer intent, and advance toward resolution every turn


- [ ] Voice sounds calm, competent, and in control
- [ ] Matches human dispatcher expectations
- [ ] Consistent across tenants

#### Policy, Providers & Delivery

##### T-V23 — Tenant Business Policy Resolver (P0)



- [ ] Define a resolver contract for: emergency rules, diagnostic fee, coverage, after-hours policy, tone preference, payment timing
- [ ] CSR layer reads the resolver output for phrasing and pacing
- [ ] FSM enforces all policy decisions (no prompt-only enforcement)
- [ ] No business rules stored only in prompts


- [ ] Tenant rules are enforceable without prompt changes
- [ ] Policy changes do not alter FSM state flow
- [ ] Unit tests cover policy resolver outputs

##### T-V04 — Voice Interaction Policy Layer (P0)



- [ ] Enforce confirmation requirements
- [ ] Manage turn limits and duration limits
- [ ] Handle polite clarification and recovery
- [ ] Determine safe hang-up conditions

##### T-V05 — Neural Voice Output via Google TTS (P0)



- [ ] Use Google Cloud Neural2 Text-to-Speech
- [ ] Generate audio via SSML (pauses + emphasis)
- [ ] Deliver audio via Twilio `<Play>` (not `<Say>`)
- [ ] Cache repeated prompts where applicable
- [ ] Implement adapter + config + feature flag
- [ ] Enable Neural2 only when `VOICE_TTS_PROVIDER=google` and `VOICE_ENABLED=true`
- [ ] Twilio `<Say>` remains the dev fallback


- [ ] No `<Say>` in production voice paths when Neural2 is enabled
- [ ] Voice output is natural and brand-consistent
- [ ] p95 voice response latency target documented

##### T-V09 — Speech-to-Text Provider (P1)



- [ ] Provider flag: `VOICE_STT_PROVIDER=twilio|google` (default `twilio`)
- [ ] Google STT enabled only when `VOICE_STT_PROVIDER=google` and `VOICE_ENABLED=true`
- [ ] Twilio STT remains the fallback if Google STT fails
- [ ] Audio ingestion pipeline exists only when Google STT is enabled
- [ ] Tenant-scoped toggle (future-ready)


- [ ] Default path uses Twilio STT (no behavior change when flag is unset)
- [ ] Google STT path produces transcripts with confidence score
- [ ] Fallback to Twilio STT on Google failure
- [ ] Cost telemetry recorded per call (STT seconds + cost estimate)

#### Fail-Closed Guarantees & Tests

##### T-V06 — Fail-Closed Intake Guarantees (P0)


- [ ] No SMS-confirmed name → no job creation
- [ ] No SMS-confirmed address → no job creation
- [x] Voice never creates jobs (voice only hands off to SMS)
- [ ] Conflicting data → clarification loop
- [ ] AI uncertainty → ask again, never assume


- [ ] No canonical records are created without SMS-confirmed name + address
- [ ] Tests prove fail-closed behavior

##### T-V07 — Voice E2E Integrity Tests (P0)


- [ ] Misheard name → correction → confirmation
- [ ] Partial address → clarification → success
- [ ] User interrupts confirmation read-back
- [ ] Silence or no response
- [ ] AI hallucinated data (must be rejected)


- [ ] All tests pass in CI
- [ ] No unconfirmed data reaches persistence layer

##### T-V21 — CSR E2E Voice Scenarios (P0)


- [ ] “No, it’s Ben Banks” → replace + confirm
- [ ] “Correct” confirms name/address
- [ ] Emergency framed without yes/no question
- [ ] Duplicate utterance ignored
- [ ] Soft confirmation applied correctly


- [ ] All tests pass in CI
- [ ] No FSM violations
- [ ] No data integrity regressions

#### Telemetry (P1)

##### T-V08 — Voice Cost & Quality Telemetry


- [ ] STT duration (seconds)
- [ ] TTS characters generated
- [ ] Call duration
- [ ] Average turns per call
- [ ] Clarification count per field


- [ ] Metrics available per tenant and per call
- [ ] Enables cost tuning and UX improvement

### T-03 Job Lifecycle & Data Integrity (P0)

- [x] Job lifecycle enforced: CREATED → ACCEPTED
- [x] issueCategory → ServiceCategory mapping verified
- [ ] Address normalization placeholder (dev-safe)
- [ ] Address validation via Google Places (prod only)
- [ ] Service-area coverage enforced
- [ ] Invalid/uncovered address fails closed
- [ ] Job creation idempotent
- [ ] Audit trail includes tenantId everywhere

---

### T-04 Payment-First Booking (Stripe) (P0)

- [ ] Diagnostic fee required before booking
- [ ] Emergency vs non-emergency pricing explicit
- [ ] Stripe test-mode Payment Intent created
- [ ] Payment metadata includes tenantId, sessionId, urgency
- [ ] Customer consent captured before payment
- [ ] Payment verification via webhook
- [ ] Job confirmation only after `payment_intent.succeeded`
- [ ] Duplicate attempts idempotent
- [ ] Payment ↔ Job linkage persisted

---

### T-05 Confirmation & Messaging (Twilio SMS) (P0)

- [ ] SMS sent only after job creation
- [ ] Tenant-branded copy
- [ ] No sensitive payment data in messages
- [ ] SMS failure does not roll back payment/job
- [ ] Observability: tenantId, paymentIntentId, jobId, SMS SID
- [ ] Twilio dry-run enabled in dev

---

### T-06 Admin & UI (P1)

- [ ] Admin dashboard shell (Signmons internal)
- [ ] TenantOrganization create/edit UI
- [ ] Tenant user list + role management
- [ ] ServiceCategory list/edit UI
- [ ] Provider toggles (AI, SMS, Voice, Address)
- [ ] Conversations timeline UI (SMS/WEB/VOICE)
- [ ] Jobs list + job detail view
- [ ] Payment badge + status indicators
- [ ] UX polish (loading, retries, inline errors, dev banner)

---

### T-07 QA & Smoke (P0)

- [ ] `scripts/smoke-test.sh` passes
- [ ] AI → payment → job → SMS validated
- [ ] AI → payment → job → VOICE validated
- [ ] Cross-tenant scenarios tested
- [ ] Providers disabled by default in dev verified

---

### T-08 Voice Provider (Twilio Voice) (P0)

- [ ] Twilio account configured
- [ ] Voice phone number purchased
- [ ] Voice webhook URLs registered
- [ ] Tenant ↔ phone number mapping table implemented
- [ ] Consent message script finalized
- [ ] Call SID logged on all voice events
- [ ] Call recording disabled by default
- [ ] Voice provider hard-disabled in dev
- [ ] Graceful failure message when provider unavailable

---

### T-09 Media Uploads (P0)

- [ ] GCS buckets per environment
- [ ] Signed URL upload endpoint
- [ ] Tenant/job-scoped object paths
- [ ] MIME type allowlist enforced
- [ ] File size limits enforced
- [ ] Virus scan placeholder (future hook)
- [ ] Media metadata stored (no blobs in DB)
- [ ] Media uploads disabled by default in dev

---

### Provider Governance (P0)

- [ ] AI disabled by default in dev
- [ ] SMS disabled by default in dev
- [ ] Voice disabled by default in dev
- [ ] Address validation disabled by default in dev
- [ ] Media uploads disabled by default in dev
- [ ] Provider failures do not corrupt core data
- [ ] Provider errors logged with tenantId + requestId

---
