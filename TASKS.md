# Signmons MVP Task Board

## Definition of Done (MVP)
- [x] Tenant can be created via Dev Auth.
- [ ] AI triage returns a response and can create a job.
- [ ] Jobs list shows the new job.
- [ ] Conversations list shows the session.
- [ ] Smoke test script passes end-to-end.
- [x] README reflects local MVP setup.

## Now
- [ ] [Owner: Partner | Status: In Progress] Run `scripts/smoke-test.sh` and confirm pass/fail output.
- [ ] [Owner: Partner | Status: In Progress] Validate UI flows: onboard tenant, triage, jobs, conversations.
- [ ] [Owner: Partner | Status: In Progress] Capture bugs/gaps with steps to reproduce.
- [ ] [Owner: You | Status: Todo] Run AI triage for a new tenant and confirm `job_created`.
- [ ] [Owner: You | Status: Todo] Verify Jobs list shows the created job.
- [ ] [Owner: You | Status: Todo] Verify Conversations list shows the session.

## Next
- [ ] [Owner: Partner | Status: Todo] Improve UI feedback for API errors.
- [ ] [Owner: Partner | Status: Todo] Add a short README section with smoke-test usage/output.
- [ ] [Owner: Partner | Status: Todo] Verify migrations on a clean machine.
- [ ] [Owner: You | Status: Todo] Add tool execution registry with schemas + executors.
- [ ] [Owner: You | Status: Todo] Add AI output/schema validation (fail closed).
- [ ] [Owner: You | Status: Todo] Add AI budgets (token caps, retries, timeouts).

## Done
- [x] Dev auth headers accepted by backend.
- [x] Prisma v7 middleware moved to `$extends`.
- [x] CORS updated for dev auth headers.
- [x] README includes local MVP setup.

## Award-Winning SaaS Gaps (Tracked)
- [ ] [Owner: You | Status: Todo] Request-scoped tenant context provider for AI flow.
- [ ] [Owner: You | Status: Todo] AI policy guard with deterministic guard order.
- [ ] [Owner: You | Status: Todo] Central AI orchestrator (prompt selection, tool allowlist, retries).
- [ ] [Owner: You | Status: Todo] Output schema enforcement for AI responses.
- [ ] [Owner: You | Status: Todo] AI-specific rate limits + per-tenant budgets.
- [ ] [Owner: You | Status: Todo] Structured AI observability (prompt/model/tool usage).
- [ ] [Owner: You | Status: Todo] PII redaction before logging + retention policy.
- [ ] [Owner: You | Status: Todo] Idempotency + confirmation for job creation tool.
