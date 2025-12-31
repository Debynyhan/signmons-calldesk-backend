# Signmons CallDesk Backend

NestJS backend powering the Signmons CallDesk AI dispatcher. Provides `/ai/triage` endpoint that proxies to OpenAI Chat Completions with function calling.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill values.
3. Run in development mode:
   ```bash
   npm run start:dev
   ```
4. Hit the AI triage endpoint:
   ```bash
   curl -X POST http://localhost:3000/ai/triage \
     -H "Content-Type: application/json" \
     -d '{
       "tenantId": "demo-tenant",
       "message": "Hi, my furnace stopped blowing warm air."
     }'
   ```

## Frontend sandbox

A lightweight Next.js client lives under `ui/` so you can test the triage workflow without crafting curl commands.

1. Copy `ui/.env.local.example` to `ui/.env.local` and set `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3000`).
2. From the repo root run:
   ```bash
   cd ui
   npm install
   npm run dev
   ```
3. The UI exposes two panels:
   - **Onboard Tenant** – submits to `/tenants`. Enter your `ADMIN_API_TOKEN` in the form; it is never stored.
   - **AI Triage** – posts messages with `tenantId` + `sessionId` to `/ai/triage`, shows replies, and prints saved jobs.

Keep using admin tokens sparingly and rotate them if you share access.

## Stack (Current + Planned)

Google Cloud:
- **Cloud Run** – runs the NestJS backend.
- **Cloud SQL** – PostgreSQL for Prisma data.
- **Vertex AI (Gemini)** – AI dispatcher (planned replacement for OpenAI provider).
- **Identity Platform** – tenant login isolation.
- **Cloud Tasks** – job offer + SLA expirations.
- **Address Validation API** – property location validation.

Third-party:
- **Stripe Connect** – split payments + contractor onboarding.
- **Twilio** – voice streams + SMS dispatch.
- **Resend** – invoices + onboarding email.
- **Sentry** – monitoring + error reporting.
- **PostHog** – product analytics + conversion tracking.

## Environment Variables

Core runtime:
- `NODE_ENV` – defaults to `development`.
- `PORT` – HTTP port (default: `3000`).
- `DATABASE_URL` – Cloud SQL connection string for Prisma.
- `ADMIN_API_TOKEN` – admin-only tenant creation token.
- `FRONTEND_ORIGINS` – comma-separated CORS origins (defaults to `http://localhost:3000,http://localhost:3101`).
- `ENABLED_TOOLS` – comma-separated tool names (default: `create_job`).

AI providers:
- `AI_PROVIDER` – `openai` (default) or `vertex`.
- `OPENAI_API_KEY` – current provider (set if using OpenAI).
- `ENABLE_GPT5_1_CODEX` – OpenAI preview flag (optional).
- `VERTEX_AI_PROJECT_ID` – GCP project for Vertex AI (planned).
- `VERTEX_AI_LOCATION` – Vertex region, e.g. `us-central1` (planned).
- `VERTEX_AI_MODEL` – Gemini model ID (planned).

Google Cloud platform:
- `GOOGLE_CLOUD_PROJECT` – base GCP project ID.
- `GOOGLE_APPLICATION_CREDENTIALS` – service account JSON path (local dev).
- `CLOUD_SQL_CONNECTION_NAME` – Cloud SQL instance ID for Cloud Run.
- `CLOUD_TASKS_QUEUE` – queue name for SLA/job offer tasks.
- `CLOUD_TASKS_LOCATION` – queue region.

Identity Platform:
- `IDENTITY_PLATFORM_PROJECT_ID` – tenant auth project.
- `IDENTITY_PLATFORM_WEB_API_KEY` – web API key for auth flows.
- `IDENTITY_PLATFORM_ISSUER` – issuer URL for JWT validation.

Address validation:
- `GOOGLE_MAPS_API_KEY` – Address Validation API key.

Stripe Connect:
- `STRIPE_SECRET_KEY` – Stripe secret key.
- `STRIPE_WEBHOOK_SECRET` – webhook signature secret.
- `STRIPE_CONNECT_CLIENT_ID` – Connect client ID.

Twilio:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

Resend:
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Sentry:
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_TRACES_SAMPLE_RATE`

PostHog:
- `POSTHOG_API_KEY`
- `POSTHOG_HOST`

Testing:
- `RUN_E2E` – set `true` to run e2e specs.
- `TEST_DATABASE_URL` – database URL for e2e runs.

Frontend sandbox (`ui/.env.local`):
- `NEXT_PUBLIC_API_URL` – UI base API URL.
- `NEXT_PUBLIC_BACKEND_API_URL` – backend origin for proxying (if used).
- `NEXT_PUBLIC_ALLOWED_DEV_ORIGINS` – allowed dev origins.
- `NEXT_PUBLIC_DEMO_TENANT_ID` – default demo tenant.

## Scripts

- `npm run start:dev` – watch mode via Nest CLI.
- `npm run build` – compile TypeScript into `dist`.
- `npm run start:prod` – run compiled build.
