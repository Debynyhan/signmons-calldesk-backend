# T-02.5 Voice Intake and AI Triage (P0)

Status is tracked in TASKS.md only. This document is the spec and reference.

## Inbound Voice Plumbing
- /api/voice/inbound webhook endpoint implemented
- Tenant resolved by called phone number (To)
- Voice disabled guard (VOICE_ENABLED=false returns safe TwiML)
- Consent message played before any intake
- Conversation created on first call event (channel=VOICE)
- requestId generated and attached to conversation
- Twilio Call SID captured and persisted

## Caller Identity
- Caller phone captured from From
- Phone normalized to E.164
- Customer created or reused by phone
- Caller phone stored on Conversation metadata

## Speech to Text Intake
- Twilio <Gather input="speech"> configured
- /api/voice/turn endpoint implemented
- Transcript extracted from SpeechResult
- Confidence score captured when provided

## Conversation Persistence
- Transcript stored as CommunicationContent
  - role = USER
  - channel = VOICE
- Voice turns appended in chronological order
- No audio blobs stored (text only)

## AI Execution
- Voice transcripts routed through existing AI pipeline
- Same schema validation, budgets, retries enforced
- Voice AI tool calls are classification-only (no job creation in voice)
- AI responses persisted as CommunicationContent (ASSISTANT)

## Voice Output
- AI responses converted to <Say>
- Follow-up <Gather> issued when FSM requires more input
- Call ends cleanly on SMS handoff, human fallback, or refusal

## Safety and Observability
- AI refusal detected on voice path
- Voice refusal logged with tenantId, conversationId, model, reason
- Fallback logged when preview model fails
- Voice interaction capped (max turns / timeout)
