# Signmons Feature List and Outcomes

This document outlines Signmons capabilities as they exist in the current codebase
and the planned roadmap. It is intended for marketing site alignment and partner
communication.

## Outcomes (what customers get)
- 24/7 call coverage so no lead is missed.
- Higher booking conversion with structured intake and confirmations.
- Faster response times through automated triage and urgency detection.
- Lower admin overhead by reducing manual callbacks and data entry.
- Consistent, professional customer experience with CSR-grade language.
- Safe, compliant disclosures with consent handled at call start.

## Live Now (in code today)
- Voice AI CSR intake on Twilio (inbound + outbound).
- Deterministic FSM flow for name, address, and issue capture.
- Humanized phrasing that preserves FSM guarantees.
- CSR Strategy Selector (opening, empathy, confirmation, urgency, next step).
- Barge-in support and duplicate event handling.
- SMS handoff and follow-up messaging.
- Structured call and transcript logging with outcomes.
- Tenant-specific settings (company name, phone number, policies).
- Tenant fee policy support (service fee, emergency fee, credit window).
- Marketing try-demo flow (form submit -> outbound call) with rate limiting.
- Try-demo call status callbacks and polling for immediate UI feedback.

## In Progress (near-term)
- Google Streaming STT integration for more natural real-time speech capture.
- Google Neural TTS integration for higher-quality speaking voice.
- Outbound call quality improvements (status feedback, retry UX refinement).

## Planned / Roadmap
- Custom brand personality profiles (tone, formality, vocabulary).
- Per-tenant voice selection (multiple TTS voices).
- Conversation style packs (concise, friendly, premium).
- Multilingual support per tenant.
- Knowledge hooks for FAQs, pricing, and policy responses.
- ServiceTitan integration (two-way customer/job sync).
- Signmons Dispatch (job board, tech availability, routing).
- Secure payments (Stripe): card-on-file, payment links, deposits.
- Scheduling intelligence (recommended windows and tech matching).
- Analytics suite (conversion, QA, escalation reasons, call outcomes).
- Human handoff workflows (warm transfer with context).

## Integrations
- Twilio Voice (telephony and call control).
- OpenAI for reasoning and dialog generation.
- Google STT/TTS (planned for best-in-class speech).
- ServiceTitan (planned two-way sync).
- Stripe (planned secure payments).

## Security and Trust
- Consent disclosures at call start.
- Strict input validation and DTO whitelisting.
- Rate limiting on high-risk endpoints (try-demo).
- Sanitized logs with structured events.
- CORS allowlist configuration for marketing frontend.

## Data captured in voice intake
- Caller name and confirmation state.
- Service address and completeness confirmation.
- Problem description / issue summary.
- Call outcomes (SMS handoff, human fallback, no-handoff end).
