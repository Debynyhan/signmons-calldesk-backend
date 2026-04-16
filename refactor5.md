# REFACTOR5 - Security Hardening + Architecture Completion (Completed)

## Objective

Close the remaining high-impact gaps for:
- SOLID (SRP, ISP, DIP, OCP)
- Separation of Concerns
- Modularity and extensibility
- OWASP-aligned security controls

This plan is intentionally incremental, test-first, and deployment-safe.

---

## Current truth snapshot

Shipped in this track:
- Step pipeline and descriptor-based voice turn execution are in place.
- `IConversationsService` and voice-state interface tokens are in place.
- Stripe webhook explicit insecure-local bypass flag is in place.
- Admin audit interceptor is implemented and wired on admin endpoints.
- Subscription gating exists on voice/SMS inbound flows.
- DTO validation exists for Twilio webhook bodies.

---

## Principles and guardrails

- SRP: one reason to change per class/service.
- ISP: inject the narrowest interface needed by each consumer.
- DIP: use injection tokens at module boundaries.
- OCP: add behavior by registration/composition, not by editing large switch files.
- SoC: transport, orchestration, domain policy, and persistence must be separate.
- Security defaults: fail closed unless an explicit local-only override is set.

Mandatory delivery rules:
1. One focused slice per commit.
2. Keep runtime behavior stable unless the slice explicitly changes behavior.
3. Each slice must include tests (unit/integration/replay as relevant).
4. No long-lived local-only commits; push after green checks.

---

## Phase plan

## P0 - Security and reliability first

### P0-1 Twilio webhook verification fail-closed (explicit local-only bypass)

Problem:
- Twilio signature verification currently runs only in production.

Work:
- Add explicit env flag: `TWILIO_SIGNATURE_ALLOW_INSECURE_LOCAL=false`.
- Verify signatures in all environments except when:
  - `NODE_ENV=development` and
  - `TWILIO_SIGNATURE_ALLOW_INSECURE_LOCAL=true`.
- Add warning log when insecure local bypass is active.
- Keep current request signature logic unchanged otherwise.

Acceptance criteria:
- Non-development requests without valid Twilio signature are rejected.
- Development bypass only works when explicit flag is true.
- Tests cover: valid signature, missing signature, invalid signature, bypass path.

---

### P0-2 Throttle policy tuning for Twilio webhook bursts

Problem:
- Global throttling may block legitimate Twilio burst traffic.

Work:
- Keep strict global defaults for general endpoints.
- Add endpoint-aware throttling policy for Twilio inbound paths:
  - `/api/voice/inbound`
  - `/api/voice/turn`
  - `/api/sms/inbound`
- Ensure abuse protection remains active while avoiding false positives.

Acceptance criteria:
- Legitimate Twilio burst traffic does not get incorrectly throttled.
- Non-webhook endpoints remain protected by conservative limits.
- Tests cover throttle behavior for webhook and non-webhook paths.

---

### P0-3 Production admin secret hardening

Problem:
- Weak/default admin token should never be allowed in production.

Work:
- Add env validation rule to fail startup when production token is weak/default.
- Ensure guard logic remains timing-safe.
- Document secure token requirements in `.env.example`.

Acceptance criteria:
- Production startup fails with unsafe admin token values.
- Development remains usable with explicit local defaults.
- Tests validate both fail and pass paths.

---

## P1 - Architecture quality and SOLID completion

### P1-1 Voice dependency bag reduction (E4 continuation)

Problem:
- Voice dependency bag is still too wide and increases coupling.

Work:
- Split dependency bag into cohesive grouped providers (or focused per-runtime deps).
- Remove unused/indirect dependencies from runtime constructors.
- Reduce constructor fan-in for core orchestration paths.

Acceptance criteria:
- Core constructors trend toward <= 5 deps (or clearly justified exceptions).
- Runtime units can be tested with narrow mocks.
- `arch:check` remains green.

---

### P1-2 Add `IAiService` token interface seam

Problem:
- Voice and orchestration consumers depend directly on concrete `AiService`.

Work:
- Introduce `AI_SERVICE` token + `IAiService` interface.
- Inject via token at module boundaries.
- Update affected tests to mock interface contract only.

Acceptance criteria:
- No cross-module concrete-class coupling to `AiService` in consumers.
- Existing behavior is unchanged.
- Unit tests pass with interface-based mocks.

---

### P1-3 Split `VoiceConversationStateService` implementation by concern

Problem:
- Interface segregation exists, but one concrete class still implements all concerns.

Work:
- Extract implementation slices (example):
  - transcript state
  - slot state (name/address/sms)
  - turn orchestration timing/listening window
- Keep token contracts stable while moving logic into focused services.

Acceptance criteria:
- No single voice state implementation class remains monolithic.
- Each extracted service has a single clear responsibility.
- Replay tests and state mutation tests remain green.

---

## P2 - Maintainability and long-term extensibility

### P2-1 Decompose large voice step descriptor file by domain

Problem:
- Step descriptor registration source is still large and costly to modify safely.

Work:
- Split step registrations into domain modules:
  - prelude/context
  - name
  - address
  - triage/handoff
- Keep deterministic priority ordering through shared constants.

Acceptance criteria:
- New step addition requires touching only its domain file.
- Central wiring remains thin.
- Behavior ordering is unchanged and replay tests are green.

---

### P2-2 Optional: further `VoiceStreamGateway` decomposition

Problem:
- Gateway can still be improved for readability and lifecycle isolation.

Work:
- Extract session cleanup/forced-hangup scheduler or similar lifecycle concerns.
- Keep gateway transport-focused.

Acceptance criteria:
- Gateway responsibilities are transport-first, with orchestration delegated.
- No behavior regressions in stream lifecycle tests.

---

## Definition of Done (for REFACTOR5)

Security:
- Fail-closed webhook verification outside explicit local bypass.
- Production secret hygiene enforced at startup.
- Throttling policy protects webhook reliability and abuse scenarios.

Architecture:
- Core orchestration classes maintain clear responsibility boundaries.
- Interfaces are narrow and injected by token across module seams.
- No new god classes introduced.

Quality gates:
- `npm run build`
- `npm run test:voice:replay`
- `npm run arch:check`
- `npm audit --omit=dev --audit-level=high` (or stricter when policy updated)

---

## Execution order

1. P0-1
2. P0-2
3. P0-3
4. P1-1
5. P1-2
6. P1-3
7. P2-1
8. P2-2 (optional)

Track each item as a focused commit/PR with its acceptance criteria in the description.

---

## Completion status (2026-04-16)

- [x] P0-1 Twilio webhook verification fail-closed with explicit local-only bypass flag
- [x] P0-2 Twilio webhook throttle policy applied to voice and SMS inbound routes
- [x] P0-3 Production admin token hardening via env validation
- [x] P1-1 Voice dependency bag reduction and grouped dependencies
- [x] P1-2 `AI_SERVICE` / `IAiService` abstraction seam
- [x] P1-3 Voice conversation state implementation split by concern
- [x] P2-1 Voice turn step descriptor decomposition by domain
- [x] P2-2 Voice stream gateway lifecycle extraction (`VoiceStreamSessionRuntime`)

REFACTOR5 is complete.

---

## Next track recommendation (REFACTOR6)

Focus the next track on lifecycle quality and boundary hardening:

1. `R6-1` Extract forced-hangup scheduling from `VoiceStreamTurnRuntime` into a dedicated runtime/service.
2. `R6-2` Decompose `VoiceTurnService` dispatch/orchestration into smaller composable runtimes and reduce constructor surface.
3. `R6-3` Introduce tenant-isolation assertions at inbound boundaries (voice/sms) as an explicit cross-tenant safety gate.
4. `R6-4` Add latency/open-handle stabilization work for test/runtime lifecycle reliability.
5. `R6-5` Capture architecture decisions (ADR docs + `arch:check` rules) to lock in boundaries and prevent regression.
