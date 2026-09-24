# Amasi Lead Engine Setup

## Before import

1. Apply `supabase/migrations/202608260001_amasi_lead_engine.sql` in the Supabase SQL Editor.
2. Create the first authenticated user, then update its `profiles.role` to `admin` in Supabase.
3. In n8n, create credentials for Supabase, Google Places, SerpAPI, Apollo, Bouncer, OpenRouter, Unipile and an error-alert inbox. Store secrets only in credentials or your approved vault.
4. In Unipile, connect the approved business email, LinkedIn account, WhatsApp account for internal handover and salesperson calendar. Use Unipile for all LinkedIn and Meta communication.

## Import order

1. `ops-bootstrap-data-tables.json`
2. `ops-error-gmail.json`
3. `ops-monitor.json`
4. `ops-health-dashboard.json`
5. `amasi-lead-discovery-main.json`
6. `amasi-approval-sequence.json`
7. `amasi-safe-dispatcher.json`
8. `amasi-unipile-inbound-reply.json`
9. `amasi-handover-calendar.json`
10. `amasi-daily-summary.json`

Keep every workflow inactive after import. Re-link credentials, change every `YOUR_SUPABASE_PROJECT` URL, and replace every `REPLACE_WITH_*` setting through n8n credentials or workflow configuration. Do not paste secrets into a Code node or exported JSON.

## Required provider configuration

- **Supabase:** create a server-side HTTP Header Auth credential with the project service key. It is for n8n only, never the browser.
- **Google Places:** enable Places API (New) and billing. Configure the discovery queries and Saudi locations in the campaign record.
- **SerpAPI:** add the key as a query-auth credential.
- **Apollo:** use an API key with organization and people-search access. Verify plan credits and endpoint access before activating discovery.
- **Bouncer:** add the verification key. Verify only shortlisted addresses, not every raw candidate.
- **OpenRouter:** use a paid API key and select a model in each AI HTTP request body. AI output must remain structured and is never permitted to send a message.
- **Unipile:** add the API key as header auth, set the account IDs in the campaign/integration records, and configure its webhook to the imported inbound workflow. Native LinkedIn, WhatsApp, Instagram and Messenger nodes are intentionally not used.

## Activation order

1. Select `OPS - Central Error` as the Error Workflow for each business workflow.
2. Add a real operations-alert address to the error workflow.
3. Activate only the lead-discovery workflow and execute it manually with a test campaign.
4. Confirm created leads, scores, source evidence, duplicate handling and API usage.
5. Activate approval and inbound workflows; then test a real inbound reply.
6. Activate dispatcher last with **5 LinkedIn messages/day** and **10 emails/day** for the first week. Increase only after clean evidence.

## Required dashboard commands

The dashboard must call the signed n8n webhooks using the Header Auth credential:

- `POST /webhook/amasi/approve-leads` with `campaign_id`, `lead_ids`, `requested_by`, and a stable `event_id`.
- `POST /webhook/amasi/handover` with `lead_id`, `assigned_to`, `meeting_requested`, `requested_by`, and a stable `event_id`.

Long-running commands should return a queued acknowledgement. The dashboard reads progress from Supabase rather than waiting for a workflow to finish.
