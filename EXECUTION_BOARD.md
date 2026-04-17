# Signmons Execution Board

Purpose: single active queue for day-to-day execution.
Backlog stays in `MVP_BACKLOG.md`. Architecture track stays in `REFACTOR6.md`.
Canonical scope/DoD charter: `SAAS_SCOPE_DOD.md`.
Canonical screen inventory: `SCREEN_INVENTORY.md`.

---

## Operating Rules

1. No coding starts without a ticket ID in `Now`.
2. One focused ticket at a time; one focused commit per ticket.
3. Every done ticket must include evidence:
   - test output, or
   - screenshot, or
   - log/API proof.
4. Do not pull items from `Later` directly to `Now`.
5. If scope changes, update this board first, then code.

---

## Definition Of Done (Execution)

- Acceptance criteria for the ticket are all checked.
- Required commands pass:
  - `npm run -s build`
  - `npm test -- --runInBand`
  - `npm run -s arch:check`
- `SESSION_HANDOFF.md` is updated.
- Ticket status moved from `Now` to `Done`.

---

## Now (WIP Limit: 1)

- [ ] FE-1001 Marketing Homepage
  - Source: `MVP_BACKLOG.md`
  - Owner: You + coding agent
  - Evidence required: implemented `SCR-PUB-001` acceptance criteria + frontend gate evidence

---

## Next (Top 5)

- (empty)

---

## Later

- MVP product tickets: `MVP_BACKLOG.md`
- Backend architecture/security phases: `REFACTOR6.md`
- Messaging and GTM content: `marketing-features.md`

---

## Weekly Cadence

1. Monday:
   - Select sprint tickets from `MVP_BACKLOG.md` and `REFACTOR6.md`.
   - Move only committed items into `Next`.
2. Daily:
   - Pull exactly one ticket from `Next` to `Now`.
   - Update blockers immediately.
3. Friday:
   - Move completed tickets to `Done` with evidence.
   - Capture carry-over and reasons.

---

## Done

- [x] R6-P0-1 SMS Twilio signature guard parity
- [x] R6-P0-2 Stripe local-bypass env validation parity
- [x] R6-P0-3 Exception diagnostic redaction policy
- [x] R6-P0-4 Payments presentation boundary extraction
- [x] R6-P0-5 Legacy voice controller suite replacement
- [x] R6-1 Forced-hangup scheduler extraction
- [x] R6-2 Voice turn orchestration decomposition
- [x] R6-3 Tenant-isolation assertions at inbound boundaries
- [x] R6-4 Latency and open-handle stabilization
- [x] R6-5 Architecture governance lock-in
- [x] REFACTOR5 completed (see `refactor5.md`)

---

## Blockers

- None currently recorded.
