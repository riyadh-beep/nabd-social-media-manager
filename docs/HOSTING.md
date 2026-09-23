# Nabd online deployment

Deployment was cancelled by the owner on September 21, 2026. Run Nabd locally for now at `http://localhost:3000`, with the local API and worker. Do not publish updates until requested. The intended future frontend host is Vercel; the persistent API and worker will still need a suitable Node/container host.

The Railway services were deployed for verification and then stopped. Their configuration remains in the account, and historical deployment targets are recorded in `deploy/targets.json`; these are not active application endpoints. A private Sites frontend publication finished before cancellation and remains an online copy, but its hosted backend has been stopped. No Unipile webhook was moved during this deployment attempt.

## Services

- Frontend: preserve the existing private Sites project. Build and publish the current source after the hosted API passes checks. The local source remains editable; future changes are tested and redeployed.
- API: a persistent Railway service built with `Dockerfile.backend`. Start command: `node --import tsx apps/api/src/server.ts`. Health check: `/health`, timeout 60 seconds.
- Worker: a separate persistent Railway service using the same source and Dockerfile. Start command: `node --import tsx apps/worker/src/index.ts`. It needs no public domain or HTTP health check.
- Data and private assets: continue using the existing Supabase database, Auth, and Storage. No data reset or migration is needed for these deployment changes.

Set each service's source root to this application directory. If uploading this directory directly it is already the root. Railway must be connected and a suitable plan selected before provisioning paid services. Configure both services with sleeping disabled, one replica, and restart policy Always through the connected hosting tools or service settings. Set `RAILWAY_DOCKERFILE_PATH=Dockerfile.backend`. New Railway services cannot use the deprecated railway.json configuration format; this project deliberately does not provide one. Configure a worker drain period sufficient for its active provider request before replacement. Existing durable leases, idempotency, and unknown-outcome reconciliation remain required if a process is terminated before draining completes.

## Runtime configuration

Transfer values securely from the local runtime environment into the host's secret-variable store. Do not upload `.env`, put secrets in Docker build arguments, or commit them. The backend image copies only dependency manifests and backend packages; the build context excludes local environment files and logs.

Required for both backend services: `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_OWNER_USER_ID`, and `DATABASE_URL`. Preserve the existing provider variables for OpenRouter, Buffer, Unipile, and optional search/import integrations. Preserve configured model selections.

The API additionally requires `APP_ORIGIN` (the exact HTTPS frontend origin) and `API_PUBLIC_URL` (the HTTPS backend origin). These are different services. Railway's `PORT` overrides `API_PORT`; production listens on `0.0.0.0`, while local development stays on loopback. `/health` returns 503 when the database is unavailable.

Keep `UNIPILE_WEBHOOK_SECRET` on the backend. After the API is healthy, update the existing Unipile callback to `API_PUBLIC_URL` plus `/v1/webhooks/unipile`, preserving its configured authentication header/signature mode. Avoid duplicate webhook registrations. A localhost quick tunnel is not permanent hosting.

Frontend build variables only: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_API_BASE_URL` pointing to the hosted API. No provider or database secret belongs in the frontend or its build variables. Add the final frontend URL to Supabase Auth's permitted redirect URLs. Hosted owner commands require the verified Supabase owner session; local login bypass is disabled in production.

If the host cannot reach a Supabase direct IPv6 database endpoint, use the project's Session Pooler on port 5432. Do not silently replace the connection string or switch the persistent worker to a transaction pooler.

Email remains optional and does not block startup. No SMTP setup is required.

## Cutover and verification

1. Connect Railway, choose an authorized plan, and configure both services and secret variables.
2. Deploy API; verify `/health` and rejection of unauthenticated owner commands.
3. Verify that current Supabase migrations and private storage policies are present.
4. Allow active local worker jobs to finish, then stop the local worker before enabling the hosted worker. Keep a single active worker during cutover.
5. Build the frontend with its three public settings, scan the browser bundle for secrets, and publish privately.
6. Verify sign-in, existing workspaces, private asset previews, content generation, and job completion on the hosted worker. Keep social test posts and outbound test messages out of deployment smoke checks unless explicitly authorized.
7. Move the Unipile callback, verify an authentic inbound delivery and durable enqueue, and confirm the queue continues with local processes stopped.

Do not declare the migration complete until hosted checks pass. Keep the local project for editing. On rollback, restore the previous hosted release and avoid enabling a second worker or replaying unknown-outcome publishing jobs.

Railway references: [persistent services](https://docs.railway.com/build-deploy), [configuration](https://docs.railway.com/guides/config-as-code), and [variables](https://docs.railway.com/variables/reference).
