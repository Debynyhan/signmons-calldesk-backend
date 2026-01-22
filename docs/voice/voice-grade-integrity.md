# T-02.6 Voice-Grade Data Integrity + CSR Delivery Layer (P0)

Status is tracked in TASKS.md only. This document is the spec and reference.

## Design Principles (Non-Negotiable)
- Signmons is not a chatbot. It is a tenant-aware, policy-driven AI CSR.
- Conversation is flexible; decisions are not.
- Tone adapts; rules do not.
- Data is never trusted until confirmed.
- The AI CSR may infer intent but may never infer facts.
- FSM is the law; CSR is the delivery; sales script is momentum.

## Layered Architecture (Hard Boundary)
1) Tenant Business Policy (rules, pricing, coverage)
2) CSR Strategy Layer (sales, empathy, branding)
3) FSM / Data Integrity Layer (confirm, lock, fail-closed)
4) Transport (Voice, SMS, Web)

Only the FSM / Data Integrity layer can mutate state.
All other layers are advisory, strategic, or presentational.

## Authority and Outcomes (MVP)
- SMS confirmation is canonical for name/address/payment.
- Voice confirmation is provisional only (candidate lock, no canonical write).
- Voice is for momentum and intent capture; SMS is for accuracy and commitment.
- FSM enforces no job creation until SMS-confirmed name + address and Stripe payment.
- Voice outcomes are explicit and logged:
  - SMS handoff (success)
  - human fallback (controlled failure)
  - call ends without handoff (true failure)

## SLOs (MVP Targets)

| Area | Metric | Target |
| --- | --- | --- |
| Conversational quality | Avg. voice turns per call | <= 8 |
| Conversational quality | Binary yes/no confirmations in a row | <= 2 |
| Conversational quality | Duplicate utterance rate | < 2% |
| Conversational quality | Clarification loops per field | <= 1.5 avg |
| Conversational quality | User correction success ("No, it's...") | >= 95% |
| Data integrity | Jobs with unconfirmed name | 0 |
| Data integrity | Jobs with unconfirmed address | 0 |
| Data integrity | Jobs without payment | 0 |
| Data integrity | Voice guesses persisted | 0 |
| Data integrity | Cross-tenant leakage | 0 |
| Conversion and revenue | Voice -> SMS handoff rate | >= 80% |
| Conversion and revenue | SMS confirmation completion | >= 85% |
| Conversion and revenue | SMS -> payment completion | >= 70% |
| Conversion and revenue | Paid job per voice call | >= 55% |
| Conversion and revenue | Human fallback rate | <= 10% |
| Experience (proxy) | Call abandonment before SMS | < 10% |
| Experience (proxy) | Repeat callers within 5 minutes | < 3% |
| Experience (proxy) | Avg. call duration | 2-4 minutes |
| Experience (proxy) | Payment confusion events | < 1% |
| System performance | p95 voice response latency | < 1.2s |
| System performance | STT confidence below threshold | < 15% |
| System performance | TTS playback errors | < 0.5% |
| System performance | Voice session timeout | < 5% |

## Execution Order (Recommended)
1) Data contract and core capture (T-V01, T-V02)
2) Content-first confirmation + tests (T-V10, T-V14)
3) Turn handling and fatigue guard (T-V03, T-V17, T-V18)
4) CSR strategy + scripts + policy resolver (T-V15, T-V16, T-V20, T-V23)
5) Provider delivery (T-V05, T-V09)
6) Fail-closed + E2E quality (T-V06, T-V07, T-V21)
7) Telemetry (T-V08)

## Data Contract
- Conversation.collectedData.name is structured:
  - candidate, confirmed, status, locked, attemptCount
- Conversation.collectedData.address mirrors name with the same structure.
- Conversation.collectedData.fieldConfirmations is append-only and includes:
  - field (name | address | sms_confirmed | payment_confirmed)
  - value
  - confirmedAt (ISO timestamp)
  - sourceEventId
  - channel (VOICE | SMS | WEB)
- CommunicationContent.payload retains audit trail:
  - transcript + confidence for voice turns
  - message for assistant outputs

## Core Intake (P0)

### T-V01 - Canonical Name Capture and Confirmation

Requirements
- Extract candidate name from speech using AI.
- Normalize (capitalize, strip filler words).
- Never persist canonical records immediately.
- Read back for confirmation in voice (candidate lock only).
- Accept explicit confirmation (yes, correct, that's right, yep).
- On rejection: clear candidate and re-ask.
- Lock candidate after voice confirmation.

Acceptance Criteria
- Voice can lock name.confirmed as a voice-confirmed candidate only.
- SMS confirmation is required before canonical name is written.
- Confirmation is logged as field_confirmed:name with channel=VOICE.

### T-V02 - Address Capture with Verification Loop

Requirements
- Multi-phase: raw -> extract -> normalize -> confirm.
- Never guess or autocomplete street names.
- Detect low-confidence or partial addresses.
- Incomplete prompt is explicit and repeatable.
- Block job creation until SMS confirms address.

Rules
- VOICE_ADDRESS_MIN_CONFIDENCE enforced (fail closed below threshold).
- After >= 2 failed attempts, safe escalation (SMS or human follow-up).
- Google Places may validate/normalize only after explicit SMS confirmation.

Acceptance Criteria
- Incomplete addresses never become canonical.
- Attempts counted and enforced.
- FSM blocks downstream actions without confirmed address.

## Confirmation and Corrections (P0)

### T-V10 - Content-First Confirmation Resolver

Requirements
- Implement resolveConfirmation(utterance, currentCandidate, fieldType).
- Return: CONFIRM | REPLACE_CANDIDATE | REJECT | UNKNOWN.
- Deterministic order:
  - explicit confirm -> CONFIRM
  - explicit reject -> REJECT
  - valid field content -> REPLACE_CANDIDATE
  - otherwise -> UNKNOWN

### T-V11 - Field Validation Heuristics
- Name valid if: 2-3 tokens, alphabetic, not stopwords.
- Address valid if: passes isIncompleteAddress (fail closed).
- No Places API or fuzzy guessing in this layer.

### T-V12 - Prompt Softening
- Name: "I heard {name}. If that's right, say 'yes'. Otherwise, say your full name again."
- Address: "I heard {address}. If that's right, say 'yes'. Otherwise, say the full address again."
- Unknown: "Sorry, I didn't catch that. You can say 'yes', 'no', or tell me the correct details."

### T-V13 - FSM Safety Guards
- Confirmed/locked fields are immutable.
- attemptCount increments on REJECT or REPLACE_CANDIDATE.
- Max attempts triggers SMS/human fallback.

### T-V14 - Confirmation Resolver Tests
- "No, it's Ben Banks" -> REPLACE_CANDIDATE -> confirm flow.
- "Correct" confirms.
- Confirmed fields cannot be overwritten.
- Incomplete address still fails closed.

## Turn Handling and Momentum (P0)

### T-V03 - Interruption-Safe Voice Turn Handling
- Each prompt defines listening_window.
- On barge-in: stop playback and route speech to expected field.
- Ignore irrelevant speech during confirmation prompts.
- Enforce idempotency per voice turn.

### T-V17 - Conversational Momentum and Fatigue Guard
- Track last N confirmation prompts.
- No more than 2 binary confirmations in a row.
- After binary confirmation, next prompt is guided or open-ended.

### T-V18 - Duplicate Utterance Suppression
- Detect identical transcripts within <= 2s.
- Ignore duplicates safely (no state mutation).
- Prevent duplicate assistant responses for the same turn.

### T-V19 - Confidence-Based Soft Confirmation
- If STT confidence >= threshold and heuristics pass and user repeats value:
  - use soft confirmation phrasing ("Great, I've got {value}.")
- Lock field only after confirmation resolver passes.

## CSR Strategy and Script Layer (P0)

### T-V15 - CSR Strategy Selector
Responsibilities
- Analyze FSM state and collectedData completeness.
- Select CSR mode: OPENING, EMPATHY, URGENCY_FRAMING, CONFIRMATION, NEXT_STEP_POSITIONING.
- Apply AIDA for flow and SERVQUAL for tone (internal only).
- Use Challenger (light) for urgency framing without yes/no questions.
- Frameworks are encoded, never exposed to users.
- Never bypass FSM confirmations.
- Never persist data in this layer.

### T-V16 - Sales Script Engine (Composable, Tenant-Safe)
Requirements
- Define CSRScript interface: opening, empathy, urgency, value, smsTransition, paymentTransition, close.
- Script chosen by emergency vs non-emergency and channel=VOICE.
- Light variation to avoid repetition.
- No scripts hard-coded in controllers (use service + templates).

### T-V20 - CSR Voice Personality Guardrails
Rules
- Never ask for information already confirmed.
- Never apologize excessively.
- Never expose internal uncertainty.
- Always frame next steps confidently.
- Treat confirmation variants (correct/yes/yep/that's right) as CONFIRM.
- Treat corrected content as REPLACE_CANDIDATE (no yes/no trap).
- Avoid rambling or free-form chat; keep prompts short and purposeful.
- Acknowledge emotion, infer intent, and advance toward resolution every turn.

## Voice Policy and Providers (P0)

### T-V23 - Tenant Business Policy Resolver
Requirements
- Resolver contract for: emergency rules, diagnostic fee, coverage, after-hours policy, tone preference, payment timing.
- CSR layer reads resolver output for phrasing and pacing.
- FSM enforces policy decisions (no prompt-only enforcement).
- No business rules stored only in prompts.

### T-V04 - Voice Interaction Policy Layer
- Enforce confirmation requirements.
- Turn limits and duration limits.
- Polite recovery and safe hang-up conditions.
- Prevent infinite loops and confirmation spam.

### T-V05 - Neural Voice Output via Google TTS
Requirements
- Google Cloud Neural2 TTS.
- SSML support (breaks, emphasis, digits).
- Twilio <Play> delivery (not <Say>).
- Cache common prompts (consent, texting you a link).
- Feature flags: VOICE_TTS_PROVIDER=google and VOICE_ENABLED=true.
- Twilio <Say> remains dev fallback.

Acceptance Criteria
- No <Say> in production when Neural2 enabled.
- Latency tracked and documented (p95).
- Audio URLs are secured (see T-V22).

### T-V09 - Speech-to-Text Provider (P1)
Requirements
- VOICE_STT_PROVIDER=twilio|google (default twilio).
- Google STT enabled only with VOICE_ENABLED=true.
- Fallback to Twilio on Google failure.
- Cost telemetry per call (seconds).

## Fail-Closed Guarantees and E2E (P0)

### T-V06 - Fail-Closed Intake Guarantees
- No SMS-confirmed name/address -> no canonical job creation.
- Conflicting data -> clarification loop.
- AI uncertainty -> ask again, never assume.
- If moving to SMS confirmation UX: voice creates candidate fields only.

### T-V07 - Voice E2E Integrity Tests
- Misheard name -> correction -> confirmation.
- Partial address -> clarification -> success.
- Barge-in during confirmation.
- Silence / no response.
- Duplicate transcripts.

### T-V21 - CSR E2E Voice Scenarios
- "No, it's Ben Banks" -> replace + confirm.
- "Correct" confirms.
- Urgency framed without yes/no question.
- Smooth SMS handoff language.
- Payment transition to SMS is confident.

## Security and Cost Controls (P0)

### T-V22 - Secure TTS Audio URL Delivery
Requirements
- Implement one of:
  - signed short-lived URL (recommended)
  - proxy streaming via API (only if necessary)
- Prevent public permanent audio URLs.
- Cache only non-sensitive prompts.
- Audit logs for TTS generation and playback URLs.

Acceptance Criteria
- No permanent public audio assets.
- Cost-effective caching strategy documented.

## Telemetry (P1)

### T-V08 - Voice Cost and Quality Telemetry
Metrics
- STT duration
- TTS characters
- Call duration
- Turns per call
- Clarification count per field
- SMS handoff completion rate
- Payment conversion rate (voice -> SMS -> paid)

## Enhancements and Gaps (Recommended)
- Spelling fallback for low-confidence names (letter-by-letter capture + confirm).
- Address components capture (street/city/zip) with explicit zip confirmation.
- Prompt/script versioning with A/B tags for measurable CSR iteration.
- Tenant-specific vocabulary hints (names, neighborhoods) to improve STT accuracy.
