# Nabd

Nabd is an Arabic and English social-media workspace for creating, reviewing, scheduling, and publishing content. It combines approved business knowledge with OpenRouter models, generates a different poster direction for each platform, and manages Instagram conversations through Unipile.

## What it includes

- Platform-specific drafts for Instagram, TikTok, and X
- Product and reference photos attached to knowledge cards
- Poster generation with `google/gemini-3.1-flash-lite-image` through OpenRouter
- A Saudi Arabia content calendar and automatic content mode
- A searchable content library with archive controls
- Instagram inbox, AI reply drafts, approved reply knowledge, and optional automatic replies
- Embedded social-account views, Arabic/English UI, dark mode, and a collapsible sidebar

## Architecture

Nabd runs as one Vercel project:

1. **Web:** the Vinext/React interface.
2. **API:** Vercel Functions adapt the Fastify API, authenticate the owner, accept webhooks, and queue durable work.
3. **Jobs:** API requests wake the durable queue immediately; a protected Vercel Cron invocation performs daily reconciliation.

Supabase provides PostgreSQL, authentication, and private asset storage. The published website uses passwordless email-link access; localhost can open directly for development.

## Local development

Requirements: Node.js 22.13 or newer and a configured Supabase project.

```bash
npm install
```

Copy `.env.example` to `.env`, add the required values, then run these commands in three terminals:

```bash
npm run dev
npm run api:dev
npm run worker:dev
```

Open `http://localhost:3000`. The API listens on `http://127.0.0.1:8787` by default.

## Environment variables

Browser-safe Vercel values:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_API_BASE_URL=https://YOUR_DOMAIN/api
```

The same Vercel project also needs the private server values documented in `.env.example`, including the database connection, Supabase secret key, owner user ID, `CRON_SECRET`, and enabled provider credentials. Never commit `.env` or copy private keys into `NEXT_PUBLIC_*` variables.

Main provider variables:

- `OPENROUTER_API_KEY` for text, vision, and poster generation
- `UNIPILE_API_KEY`, `UNIPILE_DSN`, and `UNIPILE_WEBHOOK_SECRET` for Instagram messaging
- `BUFFER_API_KEY` for supported social publishing
- `SERPAPI_API_KEY` for news discovery
- `FIRECRAWL_API_KEY` for importing public website knowledge

`APP_TIMEZONE` defaults to `Asia/Riyadh`. Production uses the Vercel origin for `APP_ORIGIN` and `API_PUBLIC_URL`; the browser API base adds `/api`.

## Database

Apply the base Supabase schema and every migration in `supabase/migrations/` in filename order. Existing production data should never be reset during deployment; web, API, and worker services all connect to the same Supabase project.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

The production API health endpoint is `/api/health`. A healthy response confirms the API can reach the database and reports which providers are configured. It does not publish content or send messages.

## Deployment

The Vercel project builds with the Nitro adapter configured in `vite.config.ts` and `vercel.json`. The catch-all function at `api/[...path].ts` hosts the API and wakes queued jobs after requests. `api/cron/worker.ts` is protected by `CRON_SECRET` and performs daily reconciliation within the Vercel Hobby cron allowance.

Pushes to the connected GitHub `main` branch deploy automatically. Local development still uses the standalone API and worker commands above.

See [hosting](docs/HOSTING.md), [integration architecture](docs/INTEGRATION-ARCHITECTURE.md), [AI inbox](docs/AI-INBOX.md), and [poster generation](docs/POSTER-GENERATION.md) for operational details.

## Security

- Real credentials stay in Vercel environment variables or the ignored local `.env` file.
- The hosted API accepts commands only from the approved Supabase owner session.
- Product images and generated assets use private storage with signed previews.
- Content remains a draft until it is approved or an explicitly enabled automatic workflow publishes it.
