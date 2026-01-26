# Signmons CallDesk Backend

NestJS backend powering the Signmons CallDesk AI dispatcher. Provides `/ai/triage` endpoint that proxies to OpenAI Chat Completions with function calling.

Data contract details for frontend/backend integration live in `data-contract.md`.

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
4. Create a tenant (admin token required):
   ```bash
   curl -X POST http://localhost:3000/tenants \
     -H "Content-Type: application/json" \
     -H "x-admin-token: dev-admin-token" \
     -d '{
       "name": "demo_hvac",
       "displayName": "Demo HVAC",
       "instructions": "Handle calls and collect details."
     }'
   ```
5. Hit the AI triage endpoint (tenantId is taken from auth headers, not body):
   ```bash
   curl -X POST http://localhost:3000/ai/triage \
     -H "Content-Type: application/json" \
     -H "x-dev-auth: dev-auth-secret" \
     -H "x-dev-user-id: dev-admin" \
     -H "x-dev-role: admin" \
     -H "x-dev-tenant-id: <TENANT_ID>" \
     -d '{
       "sessionId": "caller-1",
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
   - **AI Triage** – posts messages with `sessionId` to `/ai/triage`. Tenant identity comes from auth headers (dev or JWT).

Keep using admin tokens sparingly and rotate them if you share access.

## Environment Variables

- `OPENAI_API_KEY` – required.
- `NODE_ENV` – defaults to `development`.
- `ENABLE_GPT5_1_CODEX` – optional preview flag for new OpenAI model.
- `FRONTEND_ORIGINS` – comma-separated list of allowed UI origins for CORS (defaults to `http://localhost:3101`).
- `DEV_AUTH_ENABLED` / `DEV_AUTH_SECRET` – allow dev headers for local auth only.
- `IDENTITY_ISSUER` / `IDENTITY_AUDIENCE` – expected JWT issuer/audience in production.
- `FIREBASE_PROJECT_ID` – Firebase project id for Admin SDK token verification.

## Tenant Identity Rules (T-01)

- `tenantId` is authoritative from verified auth claims in production.
- Request body/query params are never trusted for tenant identity.
- Dev mode uses `x-dev-tenant-id` only when `DEV_AUTH_ENABLED=true`.

## Scripts

- `npm run start:dev` – watch mode via Nest CLI.
- `npm run build` – compile TypeScript into `dist`.
- `npm run start:prod` – run compiled build.
- `npm run emulator:token` – mint a local Firebase Auth emulator ID token.
- `npm run verify:token` – verify a Firebase ID token and print key claims.
