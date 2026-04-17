# Signmons Screen Inventory (Canonical UI Surface Map)

Purpose: definitive list of required product screens and route surfaces for MVP planning and delivery.

Use this with:
- `SAAS_SCOPE_DOD.md` for scope/DoD policy,
- `MVP_BACKLOG.md` for ticket ownership,
- `EXECUTION_BOARD.md` for active execution state.

---

## Status Legend

- `Shipped`: available and production-usable.
- `Beta`: implemented but operationally limited.
- `Planned`: not implemented yet.

Rule: every user-facing route must appear in this file with a ticket pointer and status.

---

## Systemic Build Rules (Screen-Level)

1. Every screen has a stable Screen ID (`SCR-*`).
2. Every screen maps to one or more backlog tickets in `MVP_BACKLOG.md`.
3. Every screen maps to required API/backend pointers (when applicable).
4. No screen is marked `Shipped` without acceptance evidence and DoD gates.
5. Work starts by moving the owning ticket to `Now` in `EXECUTION_BOARD.md`.

---

## Current UI Reality Snapshot

Current frontend app routes in repo:
- `ui/src/app/page.tsx` (single landing page)

Implication:
- most screens below are currently `Planned` and should be built incrementally by ticket order.

---

## Screen Matrix

## A) Public Marketing + Acquisition

| Screen ID | Route | Primary User | Purpose | Ticket Pointer | API/Backend Pointer | Status |
|---|---|---|---|---|---|---|
| SCR-PUB-001 | `/` | Visitor | Marketing homepage | `FE-1001` | `src/marketing/marketing.controller.ts` | Planned |
| SCR-PUB-002 | `/pricing` | Visitor | Pricing + ROI calculator | `FE-1002` | tenant fee policy/config data | Planned |
| SCR-PUB-003 | `/industries/[slug]` | Visitor | Vertical landing pages | `FE-1003` | marketing content source | Planned |
| SCR-PUB-004 | `/demo` | Visitor | Demo lead capture form | `FE-1001`, `FE-1004` | `POST /api/marketing/try-demo` | Planned |
| SCR-PUB-005 | `/demo/[leadId]` | Visitor | Demo call status page | `FE-1001` | `GET /api/marketing/try-demo/:leadId` | Planned |
| SCR-PUB-006 | `/signup` | Visitor | Signup and account creation | `FE-1004` | tenant/user onboarding APIs | Planned |
| SCR-PUB-007 | `/onboarding` | Tenant Admin | Guided setup wizard | `FE-1005` | Twilio/Stripe setup + tenant settings APIs | Planned |
| SCR-PUB-008 | `/request-service` | Visitor | Website intake form capture | Post-MVP | add website intake endpoint first | Planned |

## B) Authentication + System Screens

| Screen ID | Route | Primary User | Purpose | Ticket Pointer | API/Backend Pointer | Status |
|---|---|---|---|---|---|---|
| SCR-SYS-001 | `/login` | All app users | Authentication entry | `FE-0002` | auth guards/session APIs | Planned |
| SCR-SYS-002 | `/session-expired` | Authenticated user | Session timeout recovery | `FE-0002` | auth/session middleware | Planned |
| SCR-SYS-003 | `/forbidden` | Unauthorized user | RBAC access denied screen | `FE-0003` | role/guard enforcement | Planned |
| SCR-SYS-004 | `/not-found` | Any | 404 safe fallback | `FE-0004` | global app shell | Planned |
| SCR-SYS-005 | `global error boundary` | Any | runtime crash fallback UI | `FE-0004` | frontend telemetry/error pipeline | Planned |
| SCR-SYS-006 | `offline/maintenance state` | Any | recoverability and trust UX | `FE-0004` | app/network state handling | Planned |

## C) Tenant Ops + Dispatch Portal

| Screen ID | Route | Primary User | Purpose | Ticket Pointer | API/Backend Pointer | Status |
|---|---|---|---|---|---|---|
| SCR-TEN-001 | `/app/dashboard` | Tenant Admin/Dispatcher | KPI overview | `FE-2001` | conversations/jobs/payments analytics APIs | Planned |
| SCR-TEN-002 | `/app/calls` | Dispatcher | Calls list/search/filter | `FE-2002` | call log/transcript APIs | Planned |
| SCR-TEN-003 | `/app/calls/[conversationId]` | Dispatcher | Call detail/timeline | `FE-2002` | conversation + transcript detail APIs | Planned |
| SCR-TEN-004 | `/app/live` | Dispatcher | Live call console | `FE-2003` | websocket/live state stream | Planned |
| SCR-TEN-005 | `/app/handoff-actions` | Dispatcher | Retry SMS/manual close/escalate | `FE-2004` | sms/voice action endpoints + audit logs | Planned |
| SCR-TEN-006 | `/app/dispatch` | Dispatcher | Dispatch queue board | `FE-4001` | jobs queue APIs | Planned |
| SCR-TEN-007 | `/app/dispatch/[jobId]/assign` | Dispatcher | Technician assignment modal/page | `FE-4002` | job assignment APIs | Planned |
| SCR-TEN-008 | `/app/schedule` | Dispatcher | ETA window management | `FE-4004` | schedule/update APIs | Planned |
| SCR-TEN-009 | `/app/analytics/quality` | Tenant Admin | Conversation quality dashboard | `FE-5001` | voice quality metrics/reports | Planned |
| SCR-TEN-010 | `/app/analytics/revenue` | Tenant Admin | Revenue funnel dashboard | `FE-5002` | funnel/reporting APIs | Planned |
| SCR-TEN-011 | `/app/settings` | Tenant Admin | Tenant settings studio | `FE-5003` | `src/tenants/tenants.controller.ts` | Planned |
| SCR-TEN-012 | `/app/flags` | Tenant Admin | Feature flag controls | `FE-5005` | feature-flag config APIs | Planned |
| SCR-TEN-013 | `/app/webchat` | Tenant Agent | Authenticated web chat workspace | Post-MVP | `src/ai/ai.controller.ts` + chat persistence APIs | Planned |

## D) Customer Intake + Payment (Public Signed Link)

| Screen ID | Route | Primary User | Purpose | Ticket Pointer | API/Backend Pointer | Status |
|---|---|---|---|---|---|---|
| SCR-CUS-001 | `/intake/[token]` | Caller/Customer | Confirm details form | `FE-3001`, `FE-3002` | `GET /api/payments/intake/:token` | Beta |
| SCR-CUS-002 | `/intake/[token]/checkout` | Caller/Customer | Start checkout handoff | `FE-3003` | `POST /api/payments/intake/:token/checkout` | Beta |
| SCR-CUS-003 | `/intake/[token]/success` | Caller/Customer | Payment success return page | `FE-3003` | `/api/payments/intake/:token/success` | Beta |
| SCR-CUS-004 | `/intake/[token]/cancel` | Caller/Customer | Payment cancel return page | `FE-3003` | `/api/payments/intake/:token/cancel` | Beta |
| SCR-CUS-005 | `/status/[token]` | Caller/Customer | Job/payment status tracking | `FE-3004`, `FE-3005` | payment/job status APIs | Planned |
| SCR-CUS-006 | `/status/invalid` | Caller/Customer | expired/invalid link fallback | `FE-3005` | signed-link validation | Planned |

## E) Technician Mobile App

| Screen ID | Route | Primary User | Purpose | Ticket Pointer | API/Backend Pointer | Status |
|---|---|---|---|---|---|---|
| SCR-TEC-001 | `/tech/jobs` | Technician | Today jobs list | `FE-4003` | jobs query APIs | Planned |
| SCR-TEC-002 | `/tech/jobs/[jobId]` | Technician | Job detail + check-in/out + notes | `FE-4003` | job update APIs | Planned |

## F) Super Admin (Internal)

| Screen ID | Route | Primary User | Purpose | Ticket Pointer | API/Backend Pointer | Status |
|---|---|---|---|---|---|---|
| SCR-ADM-001 | `/admin` | Super Admin | Platform health overview | `FE-5004` | cross-tenant admin analytics APIs | Planned |
| SCR-ADM-002 | `/admin/tenants` | Super Admin | Tenant list + search | `FE-5004` | `src/tenants/tenants.controller.ts` | Planned |
| SCR-ADM-003 | `/admin/tenants/[tenantId]` | Super Admin | Tenant detail + support actions | `FE-5004` | tenant settings/admin endpoints | Planned |
| SCR-ADM-004 | `/admin/support/search` | Super Admin | Search by tenant/phone/conversation ID | `FE-5004` | call log/conversation lookup APIs | Planned |
| SCR-ADM-005 | `/admin/flags` | Super Admin | Controlled rollout governance | `FE-5005` | feature flag admin APIs | Planned |

---

## API Pointer Index (Backend Surface)

- Marketing demo:
  - `src/marketing/marketing.controller.ts`
- Voice inbound/control:
  - `src/voice/voice.controller.ts`
- SMS inbound/admin confirm:
  - `src/sms/sms.controller.ts`
- Payments/intake/Stripe webhook:
  - `src/payments/payments.controller.ts`
- Tenant admin operations:
  - `src/tenants/tenants.controller.ts`
- Authenticated AI triage endpoint:
  - `src/ai/ai.controller.ts`

---

## Build-System Tie-In (How To Use This File)

1. Planning:
   - define/update screen in this file first.
   - ensure ticket exists in `MVP_BACKLOG.md`.
2. Execution:
   - move ticket to `Now` in `EXECUTION_BOARD.md`.
   - implement only that ticket.
3. Validation:
   - satisfy acceptance criteria + DoD in `SAAS_SCOPE_DOD.md`.
4. Continuity:
   - update `SESSION_HANDOFF.md` with screen/ticket progress.

---

## Change Control

Any new route or UI surface must include:
- new `SCR-*` row,
- ticket pointer,
- API pointer (or `N/A` with rationale),
- initial status,
- evidence requirement when promoted to `Shipped`.
