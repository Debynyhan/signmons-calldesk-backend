# Data Contract - Frontend and Backend

This document defines the request and response contract for the marketing site and the SaaS web app. It also lists security and interoperability rules that both sides must follow.

## Environments
- Local: `http://localhost:3000`
- Staging/Prod: use your public API domain or ngrok URL during development.

## Shared rules
- Content-Type: `application/json` for all frontend calls.
- Encoding: UTF-8 JSON only (no form-encoded payloads).
- Strict schema: unknown fields are rejected (HTTP 400).
- Timestamps: ISO-8601 strings (e.g., `2026-01-26T12:00:00Z`).
- Phone numbers: E.164 format, or a value that can be normalized to E.164.
- Error shape is always:
  - `{ "statusCode": number, "message": string }`
  - Message is generic and not guaranteed to describe validation errors.

## CORS
- Allowed origins are defined by `FRONTEND_ORIGINS` in the backend `.env`.
- The frontend origin must be listed there (e.g., `http://localhost:5173`).
- Preflight (OPTIONS) must be allowed; backend already handles this.

## Security and OWASP alignment (minimum)
- TLS required in staging and prod.
- Strict input validation and whitelist-only DTOs (already enforced).
- Rate limit high-risk endpoints (Try Demo uses 5-minute phone throttle).
- Do not expose secrets or API keys in frontend code.
- Avoid logging raw PII in the browser console.
- Use consent checkbox text and persist the consent version with each lead.
- Prefer server-side verification for any CAPTCHA or abuse protection.
- Use CSP and security headers on the frontend hosting layer.

---

# Marketing site API

## POST `/api/marketing/try-demo`
Creates a demo lead and triggers an outbound Twilio call to the submitted phone number.

### Request payload
Required:
- `phone` (string)
- `consentToAutoCall` (boolean, must be `true`)
- `consentTextVersion` (string)

Optional:
- `name` (string)
- `company` (string)
- `email` (string, valid email)
- `demoScenario` (string enum: `hvac`, `plumbing`, `electrical`)
- `timezone` (string, IANA timezone recommended)
- `preferredCallTime` (string, ISO-8601)
- `utm` (object, key/value JSON object)
- `referrerUrl` (string)

### Response (202)
```
{
  "status": "queued" | "failed",
  "leadId": "uuid",
  "call": {
    "status": "initiated" | "failed",
    "to": "+12165551234",
    "from": "+12167448929",
    "callSid": "CA..." | null
  },
  "estimatedWaitSec": 20,
  "retry": {
    "allowed": true | false,
    "afterSec": 0 | number,
    "reason": "rate_limited" | "provider_unavailable" | null
  }
}
```

### Rate limit behavior (5 minutes)
If the same phone submits again within 5 minutes:
- `status` is `failed`
- `retry.allowed` is `true`
- `retry.afterSec` is time remaining until the 5-minute window expires
- `retry.reason` is `rate_limited`

### Example request
```
POST /api/marketing/try-demo
Content-Type: application/json

{
  "phone": "+12165551234",
  "consentToAutoCall": true,
  "consentTextVersion": "try-demo-v1",
  "name": "Ben Banks",
  "company": "Leizurely HVAC",
  "email": "ben@leizurely.com",
  "demoScenario": "hvac",
  "timezone": "America/New_York",
  "utm": { "source": "google", "medium": "cpc", "campaign": "try-demo" },
  "referrerUrl": "https://signmons.com/try-demo"
}
```

---

# Voice demo webhook (backend only)

## POST `/api/voice/demo-inbound`
- Triggered by Twilio outbound call only.
- Not for direct frontend use.

---

# SaaS web app API (pattern)

These endpoints will follow the same rules above. Additional requirements:
- Auth required (Bearer token or session cookie; no anonymous access).
- CSRF protection required if using cookies.
- Use versioned paths if breaking changes are introduced (e.g., `/api/v1/...`).
- Responses must not include sensitive data beyond what the UI needs.

When SaaS endpoints are added, this document should be extended with their exact payloads and response shapes.
