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

## Environment Variables

- `OPENAI_API_KEY` – required.
- `NODE_ENV` – defaults to `development`.
- `ENABLE_GPT5_1_CODEX` – optional preview flag for new OpenAI model.
- `FRONTEND_ORIGINS` – comma-separated list of allowed UI origins for CORS (defaults to `http://localhost:3101`).

## Scripts

- `npm run start:dev` – watch mode via Nest CLI.
- `npm run build` – compile TypeScript into `dist`.
- `npm run start:prod` – run compiled build.
