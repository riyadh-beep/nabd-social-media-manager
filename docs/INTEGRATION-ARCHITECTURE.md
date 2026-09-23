# Signaldesk integration architecture

Signaldesk uses a React/TypeScript frontend, a persistent Node.js/TypeScript API, a persistent Node.js/TypeScript worker, and Supabase. Supabase provides authentication, PostgreSQL, private storage, row-level security, operational records, ownership, approvals, idempotency, and durable background-job state.

```text
Browser -- Supabase Auth --> React frontend -- authenticated command --> Node API
                                                                  |--> PostgreSQL queue
Node worker <-----------------------------------------------------+    |--> OpenRouter
                                                                       |--> OpenRouter Images
                                                                       |--> Buffer
                                                                       |--> Unipile
Unipile --> authenticated webhook --> Node API --> PostgreSQL event + queued work --> Node worker
```

The browser receives only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_API_BASE_URL`. It never receives a database URL, a Supabase secret key, or provider credentials. Privileged state changes such as approvals, publishing, roles, provider state, jobs, and inbound messages go through authenticated API commands that verify brand ownership.

## Workflow ownership

n8n is not part of the core application architecture and must not manage application workflows. A narrowly scoped n8n + Gmail integration may be used later only for outbound email notifications. Email delivery is disabled unless the optional notification adapter URL and shared-secret variables are configured. Notification records remain in PostgreSQL, and n8n never owns core application workflows or state.

The API validates commands and inserts idempotent jobs. The worker leases queued jobs using PostgreSQL row locks, persists provider submissions and reconciliation outcomes, and holds ambiguous or unsafe work for review. Provider submission is never treated as confirmed publication without later reconciliation.

All generated content is validated against structured schemas and approved knowledge. Draft creation, image generation, publishing, and message sending are separate commands. Approval is versioned and tied to a content hash; editing invalidates approval. Automatic publishing and automatic replies default to disabled.

## Providers

- OpenRouter is server-only and configured with `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`).
- OpenRouter Images is server-only and configured with `OPENROUTER_API_KEY` and `OPENROUTER_IMAGE_MODEL` (default `google/gemini-3.1-flash-lite-image`). Generated media belongs in private Supabase Storage.
- Buffer is server-only and configured with `BUFFER_API_KEY`. The publish lifecycle is approval, durable job, provider submission, persisted result, then reconciliation.
- Unipile is encapsulated in one provider layer so that v2 and required DSN/v1 compatibility endpoints cannot be mixed across the application. Local webhook tests use fixtures. A public endpoint requires `UNIPILE_WEBHOOK_SECRET`. For v2 callbacks, the API verifies the raw body with `unipile-signature`, HMAC SHA-256, constant-time comparison, and timestamp tolerance before parsing JSON. For DSN/v1 Messaging callbacks, Unipile sends the same secret in the configured `Unipile-Auth` custom header; the API compares it in constant time before parsing JSON. In either case, it stores the valid event and queues its follow-up work transactionally.

## Local-first development

The frontend and API use their configured local ports when `APP_ORIGIN` and `API_PUBLIC_URL` are absent. `APP_ORIGIN` is the frontend URL allowed by API CORS. `API_PUBLIC_URL` is the externally reachable API URL used in provider callbacks; they are distinct values and may not be the same host.

Later, the frontend can be deployed temporarily to Vercel. Set `APP_ORIGIN` to that Vercel URL and `API_PUBLIC_URL` to the publicly reachable backend API URL. Keep the API and persistent worker on long-running Node.js/container infrastructure; Vercel is not the worker host.

Use `SUPABASE_PUBLISHABLE_KEY` in the frontend configuration and `SUPABASE_SECRET_KEY` only in API/worker processes. `SUPABASE_SERVICE_ROLE_KEY` is accepted only as a temporary backend fallback during migration. For IPv4-only development networks that cannot reach Supabase's direct database host, replace `DATABASE_URL` with the Supabase Session Pooler connection on port 5432. Short-lived serverless components should use the transaction pooler instead.
