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

## Provider Runtime Configuration (Current)
- Required baseline when voice is enabled:
  - `VOICE_ENABLED=true`
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WEBHOOK_BASE_URL`
- Streaming STT path is enabled only when all are true:
  - `VOICE_STREAMING_ENABLED=true`
  - `VOICE_STT_PROVIDER=google`
  - `GOOGLE_SPEECH_ENABLED=true`
  - `TWILIO_WEBHOOK_BASE_URL` is set (used to build `wss://.../api/voice/stream`)
- TTS playback path selection:
  - `VOICE_TTS_PROVIDER=google` and `GOOGLE_TTS_ENABLED=true` -> generate `<Play>` audio from Google TTS
  - otherwise -> Twilio `<Say>` fallback
- Consent audio cache/warm behavior:
  - active only when Google TTS provider is selected and `GOOGLE_TTS_BUCKET` is configured
  - object path: `tts/consent/<tenantId>/<hash>.<ext>`
- Address validation:
  - `ADDRESS_VALIDATION_PROVIDER=google` requires `GOOGLE_PLACES_API_KEY`

## Google Cloud Prerequisites (Current)
- APIs:
  - Cloud Speech-to-Text API
  - Cloud Text-to-Speech API
  - Cloud Storage API
  - IAM Service Account Credentials API
- Credentials:
  - `GOOGLE_APPLICATION_CREDENTIALS` service account key file
  - `GOOGLE_CLOUD_PROJECT` set for the runtime project
- Storage for TTS:
  - `GOOGLE_TTS_BUCKET` must exist and be accessible by the runtime service account
