# ADR-0003 Architecture Gate Governance

## Status
Accepted

## Date
2026-04-17

## Context
Refactor progress can regress without durable governance. The codebase needs enforceable guardrails that run in CI and a written process for boundary exceptions.

## Decision
- Keep `npm run -s arch:check` as a required gate for backend ticket completion.
- Enforce architecture gates for:
  - line count limits,
  - constructor fan-in limits,
  - shim anti-pattern detection,
  - no manual `new` in service constructors,
  - module boundary seam rules,
  - required ADR presence/structure,
  - critical production dependency vulnerability blocking.
- Require explicit rationale when adding cross-module allowlist entries.
- Require ADR updates when core boundary policy changes.

## Consequences
- Regressions are blocked early in local and CI workflows.
- Architecture exceptions are explicit and reviewable.
- Documentation and enforcement remain synchronized as the system evolves.
