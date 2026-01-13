# Signmons MVP Task Board

## Definition of Done (MVP)
- [ ] TenantOrganization created via Dev Auth (dev headers accepted).
- [ ] AI triage returns a response and can create a Job with Customer + PropertyAddress + ServiceCategory.
- [ ] Conversations list shows the session from Conversation + CommunicationEvent/Content.
- [ ] Jobs list shows the new job with correct status/urgency.
- [ ] Payment confirmation sent only after Stripe test payment succeeds (SMS/email).
- [ ] Smoke test script passes end-to-end.
- [x] README reflects local MVP setup.
- [ ] Multi-tenant isolation enforced on all reads/writes (no cross-tenant access).
- [ ] External providers disabled by default in dev (Stripe test mode, Twilio dry-run, Google disabled).

## MVP-Critical Tasks

### Multi-Tenancy & Isolation
- [ ] [Owner: You | Status: Todo] Request-scoped tenant context provider and validation.
- [ ] [Owner: You | Status: Todo] Enforce tenantId on all reads/writes (Jobs, Conversations, Communication, Customers, ServiceCategory).
- [ ] [Owner: You | Status: Todo] Add cross-tenant access tests (cannot read/update other tenants).
- [ ] [Owner: You | Status: Todo] Decide dev tenant source of truth (header vs body) and enforce consistency.

### Tenant & Onboarding
- [ ] [Owner: You | Status: Todo] Verify TenantOrganization creation and settings persisted (displayName/instructions/prompt).
- [ ] [Owner: Partner | Status: In Progress] Validate UI flows: tenant onboarding, triage, jobs, conversations.
- [ ] [Owner: Partner | Status: In Progress] Capture bugs/gaps with steps to reproduce.

### AI / Chatbot Behavior
- [ ] [Owner: You | Status: Todo] Create Conversation per session (channel, status, currentFSMState).
- [ ] [Owner: You | Status: Todo] Link job to conversation via ConversationJobLink.
- [ ] [Owner: You | Status: Todo] Output schema validation (fail closed on invalid AI responses).
- [ ] [Owner: You | Status: Todo] Tool argument validation and normalization (beyond current DTO).
- [ ] [Owner: You | Status: Todo] AI budgets (token caps, retries, timeouts).

### Job Creation & Data Integrity
- [ ] [Owner: You | Status: Todo] Confirm job status flow: CREATED before payment, ACCEPTED after payment.
- [ ] [Owner: You | Status: Todo] Ensure issueCategory maps to ServiceCategory consistently.
- [ ] [Owner: You | Status: Todo] Address normalization placeholder for dev (no paid APIs).

### Payments & Confirmation (Offline Dev)
- [ ] [Owner: You | Status: Todo] Stripe test-mode flow: Payment + LedgerEntry + StripeEvent.
- [ ] [Owner: You | Status: Todo] Post-payment confirmation message (SMS/email).
- [ ] [Owner: You | Status: Todo] Twilio dry-run mode (log only in dev).
- [ ] [Owner: You | Status: Todo] Email stub (Resend or local log).
- [ ] [Owner: You | Status: Todo] Provider feature flags: disable external calls by default in dev.

### UI & Admin Panel (MVP)
- [ ] [Owner: Partner | Status: Todo] Admin panel: tenant settings (displayName/instructions/timezone).
- [ ] [Owner: Partner | Status: Todo] Admin panel: service categories list/edit (ServiceCategory).
- [ ] [Owner: Partner | Status: Todo] Admin panel: tools toggles per tenant (enabled tools).
- [ ] [Owner: Partner | Status: Todo] Conversations timeline UI from CommunicationEvent/Content.
- [ ] [Owner: Partner | Status: Todo] Jobs list/detail UI with status + urgency + payment badge.
- [ ] [Owner: Partner | Status: Todo] UX polish: loading states, retry actions, inline errors, dev banner.

### Monetization (MVP)
- [ ] [Owner: You | Status: Todo] Pricing tier displayed in UI (test mode).
- [ ] [Owner: You | Status: Todo] Usage summary (jobs created, paid jobs, revenue).
- [ ] [Owner: You | Status: Todo] Payment-required gate before booking confirmation.

### QA / Smoke
- [ ] [Owner: Partner | Status: In Progress] Run `scripts/smoke-test.sh` and record pass/fail.
- [ ] [Owner: You | Status: Todo] Run AI triage for a new tenant and confirm `job_created`.
- [ ] [Owner: You | Status: Todo] Verify Jobs list shows the created job.
- [ ] [Owner: You | Status: Todo] Verify Conversations list shows the session.

### MVP-Critical Done
- [x] Dev auth headers accepted by backend.
- [x] CORS updated for dev auth headers (incl. x-dev-tenant-id).
- [x] Tool execution registry with executors.
- [x] Idempotency for job creation tool.
- [x] AI logging uses CommunicationEvent/Content + session markers.
- [x] TenantOrganization settings stored in JSON (displayName/instructions/prompt).

## Post-MVP / Award-Winning SaaS
- [ ] [Owner: You | Status: Todo] AI policy guard with deterministic guard order.
- [ ] [Owner: You | Status: Todo] Central AI orchestrator (prompt selection, tool allowlist, retries).
- [ ] [Owner: You | Status: Todo] Structured AI observability (prompt/model/tool usage, latency, cost).
- [ ] [Owner: You | Status: Todo] PII redaction + data retention policy.
- [ ] [Owner: You | Status: Todo] ServiceArea + Coverage checks (ServiceArea, CustomerCoverageCheck).
- [ ] [Owner: You | Status: Todo] User management + availability blocks.
- [ ] [Owner: You | Status: Todo] Job offers workflow (JobOffer + outbound comms).
- [ ] [Owner: You | Status: Todo] Stripe Connect onboarding (TenantSubscription + Connect).
- [ ] [Owner: You | Status: Todo] Human override + feedback capture for AI runs.
- [ ] [Owner: You | Status: Todo] Stripe billing portal + invoices (self-serve).
- [ ] [Owner: You | Status: Todo] Dunning/retry flows for failed payments.
- [ ] [Owner: You | Status: Todo] Revenue analytics dashboard (ARR, conversion, churn).
- [ ] [Owner: You | Status: Todo] In-app onboarding checklist + activation funnel.
