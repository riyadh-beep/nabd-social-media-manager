# n8n Package Static Audit

- Target: `C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine`
- Workflows audited: 10
- Hard failures: 0
- Warnings: 0
- Manual checks: 24
- Suggested certification: `static-pass`
- Exit code: `0`

> Static analysis is heuristic and cannot establish live execution evidence or justify `client-grade` certification.

## Hard failures

None.

## Warnings

None.

## Manual requirements

- **setup.placeholders** — Resolve documented placeholders without embedding secrets in exported JSON. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-approval-sequence.json`)
- **setup.error_workflow** — After import, assign OPS - Central Error to Gmail as this workflow's Error Workflow. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-approval-sequence.json`)
- **evidence.webhook_signature** — For signed webhooks, supply an invalid-signature rejection execution as evidence. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-approval-sequence.json`)
- **setup.placeholders** — Resolve documented placeholders without embedding secrets in exported JSON. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-daily-summary.json`)
- **evidence.missed_heartbeat** — Prove one deduplicated alert after a missed scheduled run. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-daily-summary.json`)
- **setup.error_workflow** — After import, assign OPS - Central Error to Gmail as this workflow's Error Workflow. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-daily-summary.json`)
- **setup.placeholders** — Resolve documented placeholders without embedding secrets in exported JSON. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-handover-calendar.json`)
- **setup.error_workflow** — After import, assign OPS - Central Error to Gmail as this workflow's Error Workflow. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-handover-calendar.json`)
- **evidence.webhook_signature** — For signed webhooks, supply an invalid-signature rejection execution as evidence. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-handover-calendar.json`)
- **setup.placeholders** — Resolve documented placeholders without embedding secrets in exported JSON. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-lead-discovery-main.json`)
- **evidence.missed_heartbeat** — Prove one deduplicated alert after a missed scheduled run. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-lead-discovery-main.json`)
- **setup.error_workflow** — After import, assign OPS - Central Error to Gmail as this workflow's Error Workflow. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-lead-discovery-main.json`)
- **setup.placeholders** — Resolve documented placeholders without embedding secrets in exported JSON. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-safe-dispatcher.json`)
- **evidence.missed_heartbeat** — Prove one deduplicated alert after a missed scheduled run. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-safe-dispatcher.json`)
- **setup.error_workflow** — After import, assign OPS - Central Error to Gmail as this workflow's Error Workflow. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-safe-dispatcher.json`)
- **setup.placeholders** — Resolve documented placeholders without embedding secrets in exported JSON. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-unipile-inbound-reply.json`)
- **setup.error_workflow** — After import, assign OPS - Central Error to Gmail as this workflow's Error Workflow. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-unipile-inbound-reply.json`)
- **evidence.webhook_signature** — For signed webhooks, supply an invalid-signature rejection execution as evidence. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\amasi-unipile-inbound-reply.json`)
- **setup.placeholders** — Resolve documented placeholders without embedding secrets in exported JSON. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\ops-error-gmail.json`)
- **setup.credential_binding** — Credential binding is required after import. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\ops-error-gmail.json :: Send Failure Alert`)
- **setup.credential_binding** — Credential binding is required after import. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\ops-health-dashboard.json :: Authenticated Health Dashboard`)
- **setup.placeholders** — Resolve documented placeholders without embedding secrets in exported JSON. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\ops-monitor.json`)
- **setup.credential_binding** — Credential binding is required after import. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\ops-monitor.json :: Send Missed Heartbeat Alert`)
- **setup.credential_binding** — Credential binding is required after import. (`C:\Users\reaye\Downloads\n8n pro\amasi-leads-dashboard\automation\amasi-lead-engine\ops-monitor.json :: Send Dead-Letter Alert`)
