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

## Environment Variables

- `OPENAI_API_KEY` – required.
- `NODE_ENV` – defaults to `development`.
- `ENABLE_GPT5_1_CODEX` – optional preview flag for new OpenAI model.

## Scripts

- `npm run start:dev` – watch mode via Nest CLI.
- `npm run build` – compile TypeScript into `dist`.
- `npm run start:prod` – run compiled build.
