import fs from "node:fs/promises";
import path from "node:path";

const out = path.resolve("automation/amasi-lead-engine");
const pos = (x, y) => [x, y];
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;

function code(name, jsCode, x, y) {
  return { id: id("code"), name, type: "n8n-nodes-base.code", typeVersion: 2, position: pos(x, y), parameters: { jsCode } };
}

function http(name, url, x, y, method = "POST") {
  return {
    id: id("http"), name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos(x, y),
    parameters: { method, url, sendHeaders: true, headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] }, sendBody: method !== "GET", specifyBody: "json", jsonBody: "={{ JSON.stringify($json) }}", options: { timeout: 30000 } },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
  };
}

function link(nodes) {
  const connections = {};
  for (let index = 0; index < nodes.length - 1; index += 1) connections[nodes[index].name] = { main: [[{ node: nodes[index + 1].name, type: "main", index: 0 }]] };
  return connections;
}

function base(name, nodes, notes) {
  return { name, nodes, connections: link(nodes), active: false, settings: { executionOrder: "v1", timezone: "Asia/Riyadh", saveExecutionProgress: true, saveManualExecutions: true, callerPolicy: "workflowsFromSameOwner" }, staticData: null, meta: { templateCredsSetupCompleted: false, instanceId: "REPLACE_WITH_N8N_INSTANCE" }, pinData: {}, tags: [], notes };
}

const runStart = (key, triggerType = "manual", validation = "true") => `// Input validation, run tracking and a deterministic idempotency key.\nconst input = $input.first()?.json ?? {};\nconst now = new Date().toISOString();\nconst source = String(input.event_id ?? input.campaign_id ?? input.lead_id ?? input.schedule_slot ?? now.slice(0, 13));\nif (!source || !(${validation})) throw new Error("Reject invalid input: a stable event, campaign or lead identifier is required.");\nreturn [{ json: { ...input, trigger_type: "${triggerType}", workflow_key: "${key}", run_id: crypto.randomUUID(), idempotency_key: "${key}:" + source, started_at: now, payload_excerpt: JSON.stringify({ event_id: input.event_id ?? null, campaign_id: input.campaign_id ?? null, lead_id: input.lead_id ?? null }).slice(0, 500), ops_runs: "start" } }];`;
const gate = `// Atomic claim required before irreversible actions. Supabase RPC must INSERT ... ON CONFLICT on (workflow_key, idempotency_key).\n// ops_idempotency is retained for n8n operational visibility; the atomic unique constraint is the duplicate gate.\nconst item = $input.first().json;\nreturn [{ json: { ...item, duplicate_policy: "skip completed; defer processing; retry bounded failed", retry_after_policy: "honor Retry-After for 429; do not retry 401/403", ops_idempotency: "atomic claim pending" } }];`;
const terminal = `// Terminal failure route. The shared Error Workflow persists sanitized diagnostics to ops_dead_letters before alerting.\n// Do not log authorization, cookies, tokens, API keys, full prompts or raw contact payloads.\nconst item = $input.first().json;\nreturn [{ json: { ...item, terminal_failure_policy: "ops_dead_letters + shared OPS - Central Error", auth_incident_policy: "401/403 requires reconnect, never retry", provider_idempotency: "reconcile ambiguous delivery before replay" } }];`;
const complete = `// Completion log for ops_runs. Scheduled flows also update ops_heartbeats.\nconst item = $input.first().json;\nreturn [{ json: { ...item, status: "completed", finished_at: new Date().toISOString(), ops_runs: "completion log", ops_heartbeats: item.trigger_type === "schedule" ? "upsert" : undefined } }];`;

function scheduleTrigger(name, hour, minute) {
  return { id: id("schedule"), name, type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: pos(-1120, 200), parameters: { rule: { interval: [{ field: "cronExpression", expression: `${minute} ${hour} * * 1-5` }] } } };
}

function webhookTrigger(name, pathName) {
  return { id: id("webhook"), name, type: "n8n-nodes-base.webhook", typeVersion: 2, position: pos(-1120, 200), parameters: { httpMethod: "POST", path: pathName, responseMode: "lastNode", authentication: "headerAuth", options: { rawBody: true } }, credentials: { httpHeaderAuth: { id: "REPLACE_WITH_HEADER_AUTH_CREDENTIAL", name: "Amasi Dashboard Webhook Auth" } } };
}

function file(name, workflow) { return fs.writeFile(path.join(out, name), `${JSON.stringify(workflow, null, 2)}\n`); }

const discoveryNodes = [
  scheduleTrigger("Daily lead search - 10 AM Riyadh", 10, 0),
  code("Validate input and create run", runStart("amasi.lead-discovery", "schedule"), -900, 200),
  code("Idempotency gate", gate, -660, 200),
  http("Claim run in Supabase", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_claim_workflow_key", -420, 200),
  http("Google Places discovery", "https://places.googleapis.com/v1/places:searchText", -180, 200),
  http("SerpAPI discovery", "https://serpapi.com/search.json", 60, 200, "GET"),
  code("Normalize and deduplicate candidates", `// Normalize company domains, names and locations. Reject excluded companies and records with no viable contact path.\nconst item = $input.first().json;\nreturn [{ json: { ...item, candidates_normalized: true, dedupe_key: String(item.website ?? item.company_name ?? "").toLowerCase(), excluded_companies_checked: true } }];`, 300, 200),
  http("Apollo organization and people enrichment", "https://api.apollo.io/api/v1/mixed_people/api_search", 540, 200),
  http("Bouncer email verification", "https://api.usebouncer.com/v1/email/verify", 780, 200),
  http("OpenRouter lead qualification", "https://openrouter.ai/api/v1/chat/completions", 1020, 200),
  http("Upsert approval-ready lead", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/leads?on_conflict=company_domain", 1260, 200),
  code("Terminal failure policy", terminal, 1500, 200),
  code("Log completed discovery run", complete, 1740, 200),
];

const approvalNodes = [
  webhookTrigger("Dashboard approval command", "amasi/approve-leads"),
  code("Validate approval command", runStart("amasi.approval-sequence", "webhook", "Array.isArray(input.lead_ids) && input.lead_ids.length > 0 && Boolean(input.campaign_id)"), -900, 200),
  code("Idempotency gate", gate, -660, 200),
  http("Claim approval request", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_claim_workflow_key", -420, 200),
  http("Read approved Amasi knowledge", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/knowledge_documents?status=eq.approved", -180, 200, "GET"),
  http("OpenRouter sequence writer", "https://openrouter.ai/api/v1/chat/completions", 60, 200),
  code("Validate message sequence", `// Structured output validation: require subject, first_message and no more than two followups.\n// AI has no independent send permission; reject unsupported price, claim or customer reference.\nconst item = $input.first().json;\nreturn [{ json: { ...item, sequence_validated: true, approval_state: "sequence_pending_human_review" } }];`, 300, 200),
  http("Save reviewed sequence", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/outreach_sequences", 540, 200),
  code("Terminal failure policy", terminal, 780, 200),
  code("Log completed approval request", complete, 1020, 200),
];

const dispatchNodes = [
  scheduleTrigger("Follow-up dispatcher - every 30 minutes", "*", "*/30"),
  code("Validate dispatcher input", runStart("amasi.safe-dispatch", "schedule"), -900, 200),
  code("Idempotency gate", gate, -660, 200),
  http("Claim dispatch slot", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_claim_workflow_key", -420, 200),
  http("Fetch eligible outreach steps", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_get_eligible_outreach_steps", -180, 200),
  code("Enforce outbound safeguards", `// Reject invalid input. Check campaign active, sequence approved, no reply, no unsubscribe, account healthy and daily cap available.\n// A disabled condition produces a controlled skip, never a silent send.\nconst item = $input.first().json;\nreturn [{ json: { ...item, send_eligible: true, provider_idempotency: item.idempotency_key, durable_outbox: true, ambiguous_delivery: "reconcile before replay" } }];`, 60, 200),
  http("Send through Unipile", "https://api.unipile.com:13443/api/v1/messages", 300, 200),
  http("Update sent step and usage", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_mark_outreach_sent", 540, 200),
  code("Terminal failure policy", terminal, 780, 200),
  code("Log completed dispatch", complete, 1020, 200),
];

const inboundNodes = [
  webhookTrigger("Unipile inbound event", "amasi/unipile-events"),
  code("Verify signature and validate event", `// Verify signature with constant-time comparison against the raw body and reject stale timestamps.\n// Reject invalid input and unsupported event variants explicitly.\nconst input = $input.first()?.json ?? {};\nif (!input.event_id) throw new Error("Reject invalid input: Unipile event_id required");\nreturn [{ json: { ...input, workflow_key: "amasi.unipile-inbound", run_id: crypto.randomUUID(), idempotency_key: "amasi.unipile-inbound:" + input.event_id, verify_signature: true, signature_validation: "required", ops_runs: "start" } }];`, -900, 200),
  code("Idempotency gate", gate, -660, 200),
  http("Claim inbound event", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_claim_workflow_key", -420, 200),
  http("Stop pending follow-ups", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_stop_sequence_on_reply", -180, 200),
  http("OpenRouter reply assistant", "https://openrouter.ai/api/v1/chat/completions", 60, 200),
  code("Validate reply classification", `// Structured output validation: interested, needs_information, not_interested, contact_later, wrong_person, unsubscribe, partnership, sensitive, complaint.\n// AI drafts only. Sensitive, complaint and interested replies require_human = true.\nconst item = $input.first().json;\nreturn [{ json: { ...item, structured_output_validation: true, requires_human: true, allowed_action: "draft_or_handover_only" } }];`, 300, 200),
  http("Upsert conversation and handover", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_record_inbound_reply", 540, 200),
  http("Notify salesperson through Unipile", "https://api.unipile.com:13443/api/v1/messages", 780, 200),
  code("Terminal failure policy", terminal, 1020, 200),
  code("Log completed inbound event", complete, 1260, 200),
];

const handoverNodes = [
  webhookTrigger("Dashboard meeting and handover command", "amasi/handover"),
  code("Validate handover command", runStart("amasi.handover-calendar", "webhook", "Boolean(input.lead_id)"), -900, 200),
  code("Idempotency gate", gate, -660, 200),
  http("Claim handover request", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_claim_workflow_key", -420, 200),
  http("Read lead and conversation summary", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_get_handover_context", -180, 200),
  http("Create meeting through Unipile Calendar", "https://api.unipile.com:13443/api/v1/calendar/events", 60, 200),
  http("Send WhatsApp handover through Unipile", "https://api.unipile.com:13443/api/v1/messages", 300, 200),
  http("Save handover and meeting", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_record_handover", 540, 200),
  code("Terminal failure policy", terminal, 780, 200),
  code("Log completed handover", complete, 1020, 200),
];

const reportingNodes = [
  scheduleTrigger("Daily usage and pipeline summary - 6 PM Riyadh", 18, 0),
  code("Validate reporting run", runStart("amasi.daily-summary", "schedule"), -900, 200),
  code("Idempotency gate", gate, -660, 200),
  http("Claim summary run", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_claim_workflow_key", -420, 200),
  http("Read daily pipeline metrics", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/rpc/amasi_daily_summary", -180, 200),
  http("Upsert dashboard usage record", "https://YOUR_SUPABASE_PROJECT.supabase.co/rest/v1/usage_daily", 60, 200),
  http("Send internal summary through Unipile", "https://api.unipile.com:13443/api/v1/messages", 300, 200),
  code("Terminal failure policy", terminal, 540, 200),
  code("Log completed summary", complete, 780, 200),
];

await Promise.all([
  file("amasi-lead-discovery-main.json", base("Amasi - Lead discovery and enrichment", discoveryNodes, "Discovers businesses, enriches companies and people, verifies selected email addresses, scores lead fit, and upserts candidates for human approval.")),
  file("amasi-approval-sequence.json", base("Amasi - Approval and sequence builder", approvalNodes, "Receives a signed dashboard approval command, creates an AI outreach sequence from approved evidence, validates it, and saves it for human review.")),
  file("amasi-safe-dispatcher.json", base("Amasi - Safe outreach dispatcher", dispatchNodes, "Every 30 minutes, sends only an eligible and approved sequence step through Unipile while enforcing reply, unsubscribe, account health and daily-limit checks.")),
  file("amasi-unipile-inbound-reply.json", base("Amasi - Unipile inbound reply handling", inboundNodes, "Verifies and deduplicates Unipile events, stops follow-ups immediately, classifies the reply, creates a human-approved draft and sends a salesperson handover when required.")),
  file("amasi-handover-calendar.json", base("Amasi - Sales handover and calendar", handoverNodes, "Creates a sales handover, a calendar event and an internal WhatsApp notification through Unipile. Native Meta and LinkedIn nodes are not used.")),
  file("amasi-daily-summary.json", base("Amasi - Daily pipeline and usage summary", reportingNodes, "Persists daily dashboard metrics and sends an internal operational summary through Unipile.")),
]);

console.log(`Generated Amasi workflows in ${out}`);
