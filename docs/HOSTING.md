# Nabd hosting

Nabd is deployed as one Vercel project backed by Supabase. Railway is not required.

## Runtime layout

- The Vinext web application is the public interface.
- `api/[...path].ts` adapts the Fastify API to a Vercel Function. Public API paths therefore begin with `/api`, for example `/api/health` and `/api/v1/brands`.
- API and webhook requests wake the durable database queue with Vercel `waitUntil`, so inbox replies, generation, and publishing begin without a continuously running worker.
- `api/cron/worker.ts` drains remaining jobs and schedules reconciliation once per day. Its request must contain the Vercel-managed `CRON_SECRET` bearer token.
- Supabase continues to provide PostgreSQL, Auth, and private Storage. Deploying does not reset or copy production data.

## Vercel environment

Set these browser-safe variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_API_BASE_URL=https://YOUR_DOMAIN/api
```

Set the server-only variables from `.env.example`, including `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `SUPABASE_OWNER_USER_ID`, provider credentials, and `CRON_SECRET`. Never prefix secrets with `NEXT_PUBLIC_`.

Use the production Vercel origin for both `APP_ORIGIN` and `API_PUBLIC_URL`. Add the production origin to Supabase Auth's Site URL and redirect allow list. Set the Unipile webhook to:

```text
https://YOUR_DOMAIN/api/v1/webhooks/unipile
```

Preserve its configured authentication header or signature secret and avoid duplicate webhook registrations.

## Deployment and verification

1. Apply every Supabase migration in filename order without resetting existing data.
2. Configure the Vercel environment variables for Production.
3. Push the tested commit to the connected GitHub `main` branch.
4. Verify `/api/health`, then confirm an unauthenticated `/api/v1/brands` request is rejected.
5. Sign in with the approved owner email and confirm the existing workspace loads.
6. Confirm an inbound Unipile event is accepted and its queued reply completes.

Do not send social test posts or outbound messages during deployment checks unless explicitly authorized. Local development remains available with `npm run dev`, `npm run api:dev`, and `npm run worker:dev`.
