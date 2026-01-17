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

* [ ] Caller phone captured from `From`
* [ ] Phone normalized to E.164
* [ ] Customer created or reused by phone
* [ ] Caller phone stored on Conversation metadata

#### Speech → Text Intake

* [ ] Twilio `<Gather input="speech">` configured
* [x] `/api/voice/turn` endpoint implemented
* [ ] Transcript extracted from `SpeechResult`
* [ ] Confidence score captured when provided

#### Conversation Persistence

* [ ] Transcript stored as `CommunicationContent`

  * role = USER
  * channel = VOICE
* [ ] Voice turns appended in chronological order
* [ ] No audio blobs stored (text only)

#### AI Execution

* [ ] Voice transcripts routed through existing AI pipeline
* [ ] Same schema validation, budgets, retries enforced
* [ ] Tool calls allowed from VOICE channel
* [ ] AI responses persisted as `CommunicationContent` (ASSISTANT)

#### Voice Output

* [ ] AI responses converted to `<Say>`
* [ ] Follow-up `<Gather>` issued when FSM requires more input
* [ ] Call ends cleanly on job creation or refusal

#### Safety & Observability

* [ ] AI refusal detected on voice path
* [ ] Voice refusal logged with tenantId, conversationId, model, reason
* [ ] Fallback logged when preview model fails
* [ ] Voice interaction capped (max turns / timeout)

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

**Tasks:** T-02, T-02.5, T-03
**Exit:** AI safely triages via text or voice

### Sprint 3 — Revenue Lock-In

**Tasks:** T-04, T-05, T-08
**Exit:** No unpaid job can exist

### Sprint 4 — MVP Polish & Demo Readiness

**Tasks:** T-06, T-07, T-09
**Exit:** Demo-ready MVP

---

## Global Principle

> **If a task is not in the Canonical Task Board, it does not exist.**
