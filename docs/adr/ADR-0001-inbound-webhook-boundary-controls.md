# ADR-0001 Inbound Webhook Boundary Controls

## Status
Accepted

## Date
2026-04-17

## Context
Inbound voice and SMS webhooks are high-risk entry points and must enforce tenant-safe, fail-closed behavior before business logic executes.

## Decision
- Enforce Twilio signature validation at controller guard boundaries for inbound voice and SMS.
- Keep insecure local bypass explicit and development-only via environment flags.
- Validate webhook payload boundaries with DTO pipes before use-case routing.
- Assert tenant isolation on known provider IDs (`CallSid`, `SmsSid`) and fail closed on mismatch.
- Gate inbound processing by active tenant subscription status.

## Consequences
- Security posture is stronger against forged or cross-tenant webhook traffic.
- Inbound flows may terminate early when context does not pass boundary checks.
- Boundary behavior is deterministic and testable with integration coverage.
