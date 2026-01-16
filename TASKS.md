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

* [ ] Conversation created per session (channel, status, FSM state)
* [ ] Conversation ↔ Job linking
* [ ] AI output schema validation (fail closed)
* [ ] Tool argument validation + normalization
* [ ] AI budgets (tokens, retries, timeouts)
* [ ] AI refusal + fallback logging

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

**Tasks:** T-02, T-03
**Exit:** AI safely creates jobs with full audit trail

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
