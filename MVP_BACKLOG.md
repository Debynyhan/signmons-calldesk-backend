# Signmons MVP Backlog (Epics + Tickets + Acceptance Criteria)

## How To Use
- Use this file as the master product backlog for MVP scope.
- Use `EXECUTION_BOARD.md` as the single active execution queue.
- Use `SCREEN_INVENTORY.md` as the canonical screen/route map.
- Use `AI_WORKFLOW_RULES.md` for chatbot-agnostic coding/process rules.
- Use `SESSION_HANDOFF.md` to resume work after breaks.
- Before any public claim is marked `Shipped`, ensure it has:
  - FE ticket pointer,
  - `SCR-*` screen pointer (or explicit API-only rationale),
  - acceptance evidence.
- Each ticket has a unique ID, scope, and testable acceptance criteria.
- Status checkboxes are kept here for fast progress tracking.

## Epic Index
- [EPIC-0 Platform Foundation](#epic-0-platform-foundation)
- [EPIC-1 Revenue Front Door](#epic-1-revenue-front-door)
- [EPIC-2 Core Ops Dashboard](#epic-2-core-ops-dashboard)
- [EPIC-3 Customer Intake + Payment](#epic-3-customer-intake--payment)
- [EPIC-4 Dispatch Workflow](#epic-4-dispatch-workflow)
- [EPIC-5 Analytics + Control Plane](#epic-5-analytics--control-plane)

---

## EPIC-0 Platform Foundation
Goal: shared frontend architecture, auth, security, observability.

### [ ] FE-0001 Project Shell + Design System
Scope: app shell, layout primitives, typography, spacing, color tokens, form components.
Acceptance Criteria:
- Shared component library is used by all app surfaces.
- Light/dark mode support is optional, but theme tokens must be centralized.
- Form, table, modal, toast, empty-state, and skeleton components exist.

### [ ] FE-0002 Auth + Session Management
Scope: login, logout, protected routes, session expiry handling.
Acceptance Criteria:
- Unauthenticated users are redirected to auth route from protected pages.
- Session expiry gracefully logs out users and preserves intended destination.
- Auth errors are user-safe and never expose backend internals.

### [ ] FE-0003 RBAC Route + UI Guards
Scope: tenant-admin, dispatcher, technician, super-admin role checks.
Acceptance Criteria:
- Unauthorized routes return access denied page.
- Unauthorized actions are hidden/disabled in UI.
- Role mapping is centrally defined and unit tested.

### [ ] FE-0004 App Error Boundaries + Global States
Scope: global error boundary, not found, offline, loading patterns.
Acceptance Criteria:
- Runtime crashes render a safe fallback screen with retry.
- All major data views have loading/empty/error states.
- Errors are logged to telemetry with request correlation ID.

### [ ] FE-0005 Frontend Telemetry Baseline
Scope: event tracking hooks, page analytics, API timing.
Acceptance Criteria:
- Each key workflow emits events with consistent naming.
- API error and latency telemetry appears in dashboard logs.
- PII is excluded or redacted by default.

---

## EPIC-1 Revenue Front Door
Goal: attract, convert, and onboard tenants quickly.

### [ ] FE-1001 Marketing Homepage
Scope: hero, value props, social proof, CTA.
Acceptance Criteria:
- Lighthouse performance >= 90 on mobile.
- Primary CTA appears above fold on mobile and desktop.
- Structured metadata is set (title, description, OG tags).

### [ ] FE-1002 Pricing + ROI Page
Scope: pricing tiers, calculator, FAQ.
Acceptance Criteria:
- Pricing and fee logic are sourced from config (no hardcoded duplicates).
- ROI calculator inputs validate and show deterministic outputs.
- FAQ is searchable and linkable.

### [ ] FE-1003 Industry Landing Pages
Scope: HVAC/plumbing/electrical landing pages with unique messaging.
Acceptance Criteria:
- Shared template supports per-industry content blocks.
- Each page has unique metadata + CTA tracking IDs.
- Conversion event fires on form submit and CTA click.

### [ ] FE-1004 Signup + Tenant Creation Flow
Scope: signup form, account creation, tenant bootstrap.
Acceptance Criteria:
- Signup handles field validation and duplicate-account path.
- New tenant record is created and user lands in onboarding wizard.
- Failures are recoverable without data loss.

### [ ] FE-1005 Onboarding Wizard (Twilio + Stripe + First Call)
Scope: step-by-step setup with progress state.
Acceptance Criteria:
- Steps: org profile -> Twilio config -> Stripe test mode -> test call ready.
- Step status persists between sessions.
- Completion state is visible in dashboard.

---

## EPIC-2 Core Ops Dashboard
Goal: run day-to-day operations from one place.

### [ ] FE-2001 Tenant Overview Dashboard
Scope: KPIs (calls, booked jobs, SMS handoff, payment conversion).
Acceptance Criteria:
- KPI cards support date range filters.
- Values match backend reports for same date window.
- Empty/new tenant state includes clear next actions.

### [ ] FE-2002 Calls List + Detail Drawer
Scope: recent calls table, search, status filters, detail view.
Acceptance Criteria:
- Filters: outcome, urgency, tenant, date.
- Detail drawer shows transcript and turn timeline.
- P95 call load under 2 seconds for recent window.

### [ ] FE-2003 Live Call Console (Read-Only MVP)
Scope: active call view with transcript stream and state badges.
Acceptance Criteria:
- Active calls update without manual refresh.
- Transcript timestamps are ordered and stable.
- Disconnect/reconnect handles websocket recovery.

### [ ] FE-2004 Handoff + Retry Actions
Scope: resend SMS handoff, manual close, escalate.
Acceptance Criteria:
- Each action requires explicit confirmation.
- Actions are audit-logged with actor + timestamp.
- UI reflects latest backend state within 2 seconds.

---

## EPIC-3 Customer Intake + Payment
Goal: complete intake and payment with low friction.

### [ ] FE-3001 SMS Intake Form (Mobile-First)
Scope: name, address, issue, urgency, phone correction.
Acceptance Criteria:
- Form is optimized for mobile viewport first.
- Validation messages are field-specific and readable.
- Caller can submit corrected details in under 2 minutes.

### [ ] FE-3002 Fee Disclosure + Policy Copy
Scope: service fee, emergency surcharge, terms copy.
Acceptance Criteria:
- Fee and terms displayed before payment action.
- Copy is tenant-config driven.
- Policy changes are reflected without redeploy.

### [ ] FE-3003 Stripe Checkout Hand-off
Scope: start checkout, success/cancel return handling.
Acceptance Criteria:
- Checkout opens with correct amount + currency.
- Success page shows confirmation + next step.
- Cancel path keeps intake data and supports retry.

### [ ] FE-3004 Payment Status + Recovery
Scope: pending/failed/success status page.
Acceptance Criteria:
- Polling or webhook-driven refresh updates status correctly.
- Failed payment shows actionable retry option.
- Duplicate submit is prevented client-side.

### [ ] FE-3005 Customer Status Tracking Page
Scope: post-payment progress (received, paid, dispatching).
Acceptance Criteria:
- Status timeline renders deterministic states from backend.
- Page is viewable on mobile with no auth requirement via signed link.
- Link expiration/invalid token states are handled safely.

---

## EPIC-4 Dispatch Workflow
Goal: move from paid intake to assigned technician.

### [ ] FE-4001 Dispatch Queue Board
Scope: queue, urgency badges, SLA timers, assignment actions.
Acceptance Criteria:
- Queue sorts by urgency + age by default.
- Dispatchers can assign/unassign without page reload.
- Assignment changes are optimistic with rollback on failure.

### [ ] FE-4002 Technician Assignment Modal
Scope: assignee search, availability, confirmation.
Acceptance Criteria:
- Search supports name, role, service area.
- Assign action validates technician eligibility.
- Assignment event appears in audit log.

### [ ] FE-4003 Technician Mobile Web App
Scope: today jobs, job detail, check-in/check-out, notes.
Acceptance Criteria:
- Works on iOS/Android mobile browsers.
- Offline-safe note drafting with retry.
- Check-in/out includes timestamp and optional photo/note.

### [ ] FE-4004 Schedule Window Management
Scope: confirm ETA window and status updates.
Acceptance Criteria:
- Dispatcher can update window and notify customer.
- ETA updates are visible in customer status page.
- Invalid windows are rejected with clear feedback.

---

## EPIC-5 Analytics + Control Plane
Goal: improve outcomes and enable safe self-serve configuration.

### [ ] FE-5001 Conversation Quality Dashboard
Scope: repeat-question rate, first-reply latency, handoff completion.
Acceptance Criteria:
- Metrics computed per tenant and date range.
- Trend charts include baseline comparison.
- Drill-down links to call details.

### [ ] FE-5002 Revenue Funnel Dashboard
Scope: call -> qualified -> payment -> dispatch conversion.
Acceptance Criteria:
- Funnel stages use consistent backend definitions.
- Drop-off percentages and counts are shown per stage.
- Export to CSV works for filtered window.

### [ ] FE-5003 Tenant Settings Studio
Scope: prompt profile, fee policy, emergency settings, service area settings.
Acceptance Criteria:
- Settings update via validated forms only.
- Save creates visible change history entry.
- Risky settings require confirmation + revert path.

### [ ] FE-5004 Super Admin Panel (Internal)
Scope: tenant health, subscription status, support tools.
Acceptance Criteria:
- Internal role required; no tenant cross-visibility leaks.
- Admin actions produce immutable audit events.
- Search by tenant, phone, conversation ID supported.

### [ ] FE-5005 Feature Flags + Controlled Rollouts
Scope: per-tenant feature gating for new UX flows.
Acceptance Criteria:
- Flags can be toggled per tenant without redeploy.
- UI branches are deterministic and test-covered.
- Rollback path validated in staging.

---

## Release Gates (Apply To Every Epic)
- [ ] `lint` + typecheck pass for frontend packages.
- [ ] Critical user journey E2E tests pass.
- [ ] Accessibility pass on key flows (keyboard + labels + contrast).
- [ ] Telemetry events verified in staging.
- [ ] Security review complete for auth/payment/admin surfaces.
- [ ] Marketing claim alignment check completed against `SCREEN_INVENTORY.md` and `marketing-features.md`.

## Explicitly Deferred (Post-MVP)
- ServiceTitan integration adapters and two-way sync.
- Website intake (forms/chat) pipeline.
- Authenticated in-app web chat experience.

## Suggested Delivery Order
1. EPIC-0
2. EPIC-1
3. EPIC-3
4. EPIC-2
5. EPIC-4
6. EPIC-5

---

## Sprint Plan (1-6)
Assumption: 2-week sprints, one cross-functional team, all release gates apply each sprint.

### Sprint 1 — Platform Foundation
Goal: establish frontend architecture and production-safe baseline patterns.
Ticket Bundle:
- [ ] FE-0001 Project Shell + Design System
- [ ] FE-0002 Auth + Session Management
- [ ] FE-0003 RBAC Route + UI Guards
- [ ] FE-0004 App Error Boundaries + Global States
- [ ] FE-0005 Frontend Telemetry Baseline
Sprint Exit Criteria:
- Protected routes and RBAC enforced end-to-end.
- Shared components used in all new pages.
- Error/loading/empty patterns implemented and consistent.
- Telemetry visible in staging for auth + page flows.

### Sprint 2 — Revenue Front Door
Goal: launch public conversion funnel and tenant self-serve onboarding start.
Ticket Bundle:
- [ ] FE-1001 Marketing Homepage
- [ ] FE-1002 Pricing + ROI Page
- [ ] FE-1003 Industry Landing Pages
- [ ] FE-1004 Signup + Tenant Creation Flow
- [ ] FE-1005 Onboarding Wizard (Twilio + Stripe + First Call)
Sprint Exit Criteria:
- Public pages are live, tracked, and mobile-performant.
- Signup creates tenant and starts onboarding wizard.
- Onboarding progress persists and resumes correctly.
- Conversion events are captured for all CTA paths.

### Sprint 3 — Customer Intake + Payment
Goal: complete caller intake and payment journey from SMS link to payment result.
Ticket Bundle:
- [ ] FE-3001 SMS Intake Form (Mobile-First)
- [ ] FE-3002 Fee Disclosure + Policy Copy
- [ ] FE-3003 Stripe Checkout Hand-off
- [ ] FE-3004 Payment Status + Recovery
- [ ] FE-3005 Customer Status Tracking Page
Sprint Exit Criteria:
- Caller can complete intake and pay using test mode.
- Success/cancel/failed payment paths are fully handled.
- Signed-link customer status page is functional and safe.
- No duplicate submission/payment retries from UI race conditions.

### Sprint 4 — Ops Visibility + Dispatch Entry
Goal: give tenant ops teams complete call visibility and first dispatch controls.
Ticket Bundle:
- [ ] FE-2001 Tenant Overview Dashboard
- [ ] FE-2002 Calls List + Detail Drawer
- [ ] FE-2003 Live Call Console (Read-Only MVP)
- [ ] FE-2004 Handoff + Retry Actions
- [ ] FE-4001 Dispatch Queue Board
Sprint Exit Criteria:
- Ops can track lead lifecycle from call to payment.
- Active calls and transcript updates render reliably.
- Handoff retry/escalation actions are auditable.
- Dispatch queue is usable for day-to-day triage.

### Sprint 5 — Dispatch Completion + Quality Analytics
Goal: complete operational dispatch workflows and start conversation quality analytics.
Ticket Bundle:
- [ ] FE-4002 Technician Assignment Modal
- [ ] FE-4003 Technician Mobile Web App
- [ ] FE-4004 Schedule Window Management
- [ ] FE-5001 Conversation Quality Dashboard
Sprint Exit Criteria:
- Dispatcher can assign, schedule, and update job progression.
- Technician mobile app works on iOS/Android browsers.
- Conversation quality KPIs are available with drill-down links.

### Sprint 6 — Control Plane + Rollout Safety
Goal: finalize tenant control and internal governance for scale.
Ticket Bundle:
- [ ] FE-5002 Revenue Funnel Dashboard
- [ ] FE-5003 Tenant Settings Studio
- [ ] FE-5004 Super Admin Panel (Internal)
- [ ] FE-5005 Feature Flags + Controlled Rollouts
Sprint Exit Criteria:
- Funnel and financial conversion reporting is tenant-accurate.
- Tenant admins can safely configure core behavior.
- Super-admin workflows are gated and audit-safe.
- Feature flags support per-tenant rollout and rollback.

---

## Sprint Governance (Best Practices)
- Sprint Planning: lock sprint scope by ticket ID; move overflow only at sprint review.
- Mid-Sprint Gate: run release gates + E2E smoke by day 5.
- End-Sprint Gate: no ticket is done without acceptance criteria evidence (test, screenshot, metric, or log).
- Demo Rule: demo only completed tickets with real staging data.
