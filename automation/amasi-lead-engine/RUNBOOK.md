# Amasi Lead Engine Runbook

| Incident | Owner | First checks | Safe recovery |
| --- | --- | --- | --- |
| Invalid input spike | Admin | Inspect `workflow_runs` payload excerpt and dashboard command version. | Correct the calling application; do not replay malformed commands. |
| Duplicate or in-progress key | Admin | Inspect `idempotency_keys` and the provider-side result. | Wait for the current claim or reconcile the provider result before replay. |
| Provider 429 | Admin | Inspect retry count and provider quota. | Allow bounded retry using `Retry-After`; reduce campaign rate if repeated. |
| 401/403 | Admin | Confirm the named credential and account status. | Reconnect or replace the credential; never retry this state automatically. |
| Timeout or 5xx | Admin | Check `ops_dead_letters`, provider status and the affected lead state. | Reconcile whether a message was delivered before any replay. |
| Unipile account disconnected | Admin | Check account health and active channel account ID. | Reconnect through Unipile, run a test message, then resume campaign. |
| Missed heartbeat | Admin | Inspect `ops_heartbeats`, n8n execution history and n8n instance health. | Resolve the trigger outage and confirm one fresh heartbeat clears the alert. |
| Reply or unsubscribe | Salesperson | Confirm the message belongs to the correct lead and conversation. | The inbound workflow stops follow-ups. Never restart a sequence for an unsubscribed lead. |
| AI output failure | Admin | Inspect redacted execution details and the selected model. | Correct the structured prompt or model setting; keep the lead awaiting human review. |

Never replay a send, handover, or calendar workflow until the idempotency claim and the provider-side result both show that the action did not complete.
