-- Amasi Lead Engine: single-company CRM, outreach control and operational audit.
-- Run this migration in a new Supabase project before importing the n8n package.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'salesperson');
create type public.lead_status as enum ('new', 'needs_approval', 'approved', 'sequence_pending_review', 'contacted', 'replied', 'interested', 'not_interested', 'unsubscribed', 'handed_over', 'closed');
create type public.channel_type as enum ('email', 'linkedin', 'whatsapp', 'calendar');
create type public.message_direction as enum ('inbound', 'outbound');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role not null default 'salesperson',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_settings (
  id boolean primary key default true check (id),
  company_name text not null default 'Amasi Solutions',
  arabic_company_name text not null default 'أمسي الحلول',
  website text,
  services jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '[]'::jsonb,
  faqs jsonb not null default '[]'::jsonb,
  excluded_companies jsonb not null default '[]'::jsonb,
  lead_rules jsonb not null default '{"approval_mode":"manual","minimum_score":70}'::jsonb,
  sending_limits jsonb not null default '{"email_daily":40,"linkedin_daily":15}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  channel public.channel_type not null,
  provider text not null default 'unipile',
  provider_account_id text not null unique,
  owner_id uuid references public.profiles(user_id),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'warning')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_market text not null,
  criteria jsonb not null default '{}'::jsonb,
  message_style text,
  channels public.channel_type[] not null default array['email'::public.channel_type],
  daily_email_limit integer not null default 40 check (daily_email_limit between 0 and 500),
  daily_linkedin_limit integer not null default 15 check (daily_linkedin_limit between 0 and 50),
  active boolean not null default false,
  assigned_to uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  company_name text not null,
  company_domain text,
  website text,
  industry text,
  location text,
  company_size text,
  social_profiles jsonb not null default '{}'::jsonb,
  business_activity text,
  contact_name text,
  contact_role text,
  contact_email text,
  contact_phone text,
  linkedin_url text,
  email_verified boolean not null default false,
  lead_source text,
  source_evidence jsonb not null default '[]'::jsonb,
  lead_score integer not null default 0 check (lead_score between 0 and 100),
  score_reason text,
  ai_notes text,
  fit_offer text,
  status public.lead_status not null default 'new',
  assigned_to uuid references public.profiles(user_id),
  opted_out_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (company_domain, campaign_id)
);
create index leads_status_score_idx on public.leads (status, lead_score desc);
create index leads_assigned_to_idx on public.leads (assigned_to);

create table public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  channel public.channel_type not null check (channel in ('email', 'linkedin')),
  content jsonb not null,
  evidence_used jsonb not null default '[]'::jsonb,
  approval_state text not null default 'pending_review' check (approval_state in ('draft', 'pending_review', 'approved', 'rejected', 'stopped')),
  approved_by uuid references public.profiles(user_id),
  approved_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outreach_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.outreach_sequences(id) on delete cascade,
  step_number integer not null check (step_number between 1 and 3),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  provider_message_id text unique,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'sent', 'skipped', 'cancelled', 'failed')),
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, step_number)
);
create index outreach_steps_eligible_idx on public.outreach_steps (status, scheduled_for) where status = 'pending';

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel public.channel_type not null check (channel in ('email', 'linkedin', 'whatsapp')),
  provider_conversation_id text unique,
  classification text,
  summary text,
  requires_human boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction public.message_direction not null,
  provider_message_id text unique,
  content text not null,
  ai_generated boolean not null default false,
  approved_by uuid references public.profiles(user_id),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  assigned_to uuid references public.profiles(user_id),
  summary text not null,
  recommended_action text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'closed')),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  assigned_to uuid references public.profiles(user_id),
  provider_event_id text unique,
  starts_at timestamptz not null,
  ends_at timestamptz,
  booking_url text,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'completed')),
  created_at timestamptz not null default now()
);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  document_type text not null check (document_type in ('company_profile', 'service', 'pricing', 'faq', 'case_study', 'brochure', 'successful_message')),
  storage_path text,
  content text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  approved_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.idempotency_keys (
  workflow_key text not null,
  idempotency_key text not null,
  run_id uuid not null,
  status text not null check (status in ('processing', 'completed', 'failed')),
  result_ref text,
  payload_excerpt jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days',
  primary key (workflow_key, idempotency_key)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique,
  workflow_key text not null,
  trigger_type text,
  status text not null check (status in ('started', 'completed', 'failed', 'skipped')),
  idempotency_key text,
  payload_excerpt jsonb not null default '{}'::jsonb,
  error_class text,
  error_summary text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.dead_letters (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  run_id uuid,
  idempotency_key text,
  failed_node text,
  attempts integer not null default 1,
  error_class text,
  error_summary text,
  payload_excerpt jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed', 'resolved')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table public.usage_daily (
  usage_date date primary key,
  leads_generated integer not null default 0,
  emails_verified integer not null default 0,
  emails_sent integer not null default 0,
  linkedin_messages integer not null default 0,
  followups_sent integer not null default 0,
  ai_replies_generated integer not null default 0,
  api_requests integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(user_id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.amasi_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = (select auth.uid()) and role = 'admin');
$$;

create or replace function public.amasi_claim_workflow_key(p_workflow_key text, p_idempotency_key text, p_run_id uuid, p_payload_excerpt jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare existing public.idempotency_keys;
begin
  insert into public.idempotency_keys (workflow_key, idempotency_key, run_id, status, payload_excerpt)
  values (p_workflow_key, p_idempotency_key, p_run_id, 'processing', coalesce(p_payload_excerpt, '{}'::jsonb))
  on conflict (workflow_key, idempotency_key) do nothing;
  select * into existing from public.idempotency_keys where workflow_key = p_workflow_key and idempotency_key = p_idempotency_key;
  insert into public.workflow_runs (run_id, workflow_key, status, idempotency_key, payload_excerpt)
  values (p_run_id, p_workflow_key, case when existing.run_id = p_run_id then 'started' else 'skipped' end, p_idempotency_key, coalesce(p_payload_excerpt, '{}'::jsonb))
  on conflict (run_id) do nothing;
  return jsonb_build_object('claimed', existing.run_id = p_run_id, 'status', existing.status, 'run_id', existing.run_id);
end;
$$;

create or replace function public.amasi_stop_sequence_on_reply(p_lead_id uuid, p_conversation_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.outreach_sequences set approval_state = 'stopped', stopped_at = now(), stop_reason = 'reply_received', updated_at = now()
  where lead_id = p_lead_id and approval_state in ('approved', 'pending_review');
  update public.outreach_steps set status = 'cancelled', updated_at = now()
  where sequence_id in (select id from public.outreach_sequences where lead_id = p_lead_id) and status in ('pending', 'claimed');
  update public.leads set status = 'replied', updated_at = now() where id = p_lead_id and status <> 'unsubscribed';
end;
$$;

create or replace function public.amasi_get_eligible_outreach_steps()
returns table(step_id uuid, lead_id uuid, sequence_id uuid, channel public.channel_type, content jsonb, idempotency_key text)
language sql security definer set search_path = public as $$
  select s.id, q.lead_id, q.id, q.channel, q.content, coalesce(s.idempotency_key, 'send:' || s.id::text)
  from public.outreach_steps s
  join public.outreach_sequences q on q.id = s.sequence_id
  join public.leads l on l.id = q.lead_id
  join public.campaigns c on c.id = q.campaign_id
  where s.status = 'pending' and s.scheduled_for <= now() and q.approval_state = 'approved'
    and c.active and l.opted_out_at is null and l.status not in ('replied', 'unsubscribed', 'not_interested');
$$;

create or replace function public.amasi_daily_summary()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('leads_generated', count(*) filter (where created_at::date = current_date), 'approved', count(*) filter (where status in ('approved', 'sequence_pending_review')), 'interested', count(*) filter (where status = 'interested'), 'meetings', (select count(*) from public.meetings where created_at::date = current_date)) from public.leads;
$$;

create or replace function public.amasi_touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.amasi_touch_updated_at();
create trigger company_settings_touch before update on public.company_settings for each row execute function public.amasi_touch_updated_at();
create trigger connected_accounts_touch before update on public.connected_accounts for each row execute function public.amasi_touch_updated_at();
create trigger campaigns_touch before update on public.campaigns for each row execute function public.amasi_touch_updated_at();
create trigger leads_touch before update on public.leads for each row execute function public.amasi_touch_updated_at();
create trigger sequences_touch before update on public.outreach_sequences for each row execute function public.amasi_touch_updated_at();
create trigger steps_touch before update on public.outreach_steps for each row execute function public.amasi_touch_updated_at();
create trigger conversations_touch before update on public.conversations for each row execute function public.amasi_touch_updated_at();
create trigger knowledge_touch before update on public.knowledge_documents for each row execute function public.amasi_touch_updated_at();

insert into public.company_settings (id) values (true) on conflict (id) do nothing;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.company_settings, public.connected_accounts, public.campaigns, public.leads, public.outreach_sequences, public.outreach_steps, public.conversations, public.messages, public.handovers, public.meetings, public.knowledge_documents to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant update on public.leads, public.outreach_sequences, public.messages, public.handovers to authenticated;

revoke execute on function public.amasi_is_admin() from public;
revoke execute on function public.amasi_claim_workflow_key(text, text, uuid, jsonb) from public;
revoke execute on function public.amasi_stop_sequence_on_reply(uuid, uuid) from public;
revoke execute on function public.amasi_get_eligible_outreach_steps() from public;
revoke execute on function public.amasi_daily_summary() from public;

grant execute on function public.amasi_is_admin() to authenticated;
grant execute on function public.amasi_claim_workflow_key(text, text, uuid, jsonb) to service_role;
grant execute on function public.amasi_stop_sequence_on_reply(uuid, uuid) to service_role;
grant execute on function public.amasi_get_eligible_outreach_steps() to service_role;
grant execute on function public.amasi_daily_summary() to service_role;

alter table public.profiles enable row level security;
alter table public.company_settings enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
alter table public.outreach_sequences enable row level security;
alter table public.outreach_steps enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.handovers enable row level security;
alter table public.meetings enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.dead_letters enable row level security;
alter table public.usage_daily enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles: own or admin read" on public.profiles for select to authenticated using ((select auth.uid()) = user_id or public.amasi_is_admin());
create policy "profiles: create own salesperson profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id and role = 'salesperson');
create policy "team can read sales records" on public.leads for select to authenticated using (true);
create policy "admin or assignee updates lead" on public.leads for update to authenticated using (public.amasi_is_admin() or assigned_to = (select auth.uid())) with check (public.amasi_is_admin() or assigned_to = (select auth.uid()));
create policy "team can read sequences" on public.outreach_sequences for select to authenticated using (true);
create policy "admin or assignee updates sequence" on public.outreach_sequences for update to authenticated using (public.amasi_is_admin() or exists (select 1 from public.leads where leads.id = outreach_sequences.lead_id and leads.assigned_to = (select auth.uid()))) with check (public.amasi_is_admin() or exists (select 1 from public.leads where leads.id = outreach_sequences.lead_id and leads.assigned_to = (select auth.uid())));
create policy "team can read steps" on public.outreach_steps for select to authenticated using (true);
create policy "team can read conversations" on public.conversations for select to authenticated using (true);
create policy "team can read messages" on public.messages for select to authenticated using (true);
create policy "salesperson can approve drafted message" on public.messages for update to authenticated using (true) with check (approved_by = (select auth.uid()) or public.amasi_is_admin());
create policy "team can read handovers" on public.handovers for select to authenticated using (true);
create policy "assignee can acknowledge handover" on public.handovers for update to authenticated using (assigned_to = (select auth.uid()) or public.amasi_is_admin()) with check (assigned_to = (select auth.uid()) or public.amasi_is_admin());
create policy "team can read meetings" on public.meetings for select to authenticated using (true);
create policy "team can read active account status" on public.connected_accounts for select to authenticated using (true);
create policy "team can read company settings" on public.company_settings for select to authenticated using (true);
create policy "admin updates company settings" on public.company_settings for update to authenticated using (public.amasi_is_admin()) with check (public.amasi_is_admin());
create policy "team can read campaigns" on public.campaigns for select to authenticated using (true);
create policy "team reads approved knowledge" on public.knowledge_documents for select to authenticated using (status = 'approved' or public.amasi_is_admin());
create policy "admin manages knowledge" on public.knowledge_documents for all to authenticated using (public.amasi_is_admin()) with check (public.amasi_is_admin());
create policy "admin manages campaigns" on public.campaigns for all to authenticated using (public.amasi_is_admin()) with check (public.amasi_is_admin());
create policy "admin reads operations" on public.workflow_runs for select to authenticated using (public.amasi_is_admin());
create policy "admin reads dead letters" on public.dead_letters for select to authenticated using (public.amasi_is_admin());
create policy "admin reads usage" on public.usage_daily for select to authenticated using (public.amasi_is_admin());
create policy "team writes own audit event" on public.audit_logs for insert to authenticated with check (actor_id = (select auth.uid()));
create policy "admin reads audit trail" on public.audit_logs for select to authenticated using (public.amasi_is_admin());

-- idempotency_keys is service-role-only. n8n uses the service key server-side and bypasses RLS.
-- Never expose the Supabase service key or these RPC functions to browser code.
