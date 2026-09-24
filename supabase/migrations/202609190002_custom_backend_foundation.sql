-- Signaldesk custom API and worker foundation.
-- This migration is additive to the existing Signaldesk schema.  Application
-- commands run through the Node API; browser clients do not receive write
-- access to operational tables.

alter table public.content_drafts
  add column if not exists source_facts uuid[] not null default '{}',
  add column if not exists approved_version integer,
  add column if not exists approval_hash text,
  add column if not exists published_at timestamptz;

create table if not exists public.automation_settings (
  brand_id uuid primary key references public.brand_profiles(id) on delete cascade,
  generation_enabled boolean not null default false,
  publishing_enabled boolean not null default false,
  reply_sending_enabled boolean not null default false,
  daily_generation_time time,
  updated_at timestamptz not null default now()
);

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_profiles(id) on delete cascade,
  kind text not null check (kind in ('content.generate','image.generate','publish.submit','publish.reconcile','inbox.process','reply.send','notification.deliver')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','needs_review','dead_letter','cancelled','unknown_outcome')),
  idempotency_key text not null,
  run_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  error_class text,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, kind, idempotency_key)
);

create index if not exists background_jobs_claim_idx on public.background_jobs (run_at, created_at) where status = 'queued';
create index if not exists background_jobs_brand_idx on public.background_jobs (brand_id, created_at desc);

create table if not exists public.draft_approvals (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  version integer not null,
  state text not null check (state in ('approved','revoked')),
  content_hash text not null,
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (draft_id, version)
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_account_id text not null,
  event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  verified_at timestamptz not null,
  payload jsonb not null,
  processing_status text not null default 'queued' check (processing_status in ('queued','processing','completed','failed','ignored')),
  unique (provider, external_account_id, event_id)
);

create table if not exists public.provider_attempts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_profiles(id) on delete cascade,
  job_id uuid references public.background_jobs(id) on delete set null,
  provider text not null,
  operation text not null,
  idempotency_key text not null,
  provider_reference text,
  state text not null check (state in ('submitted','confirmed','failed','unknown')),
  result_excerpt jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, operation, idempotency_key)
);

create table if not exists public.reply_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body text not null,
  language text check (language in ('ar','en')),
  status text not null default 'draft' check (status in ('draft','approved','sent','cancelled')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_records (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_profiles(id) on delete cascade,
  category text not null,
  payload jsonb not null default '{}'::jsonb,
  delivery_state text not null default 'disabled' check (delivery_state in ('disabled','queued','delivered','failed')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table if not exists public.schedule_occurrences (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_profiles(id) on delete cascade,
  schedule_key text not null,
  scheduled_for timestamptz not null,
  job_id uuid references public.background_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (brand_id, schedule_key, scheduled_for)
);

alter table public.automation_settings enable row level security;
alter table public.background_jobs enable row level security;
alter table public.draft_approvals enable row level security;
alter table public.webhook_events enable row level security;
alter table public.provider_attempts enable row level security;
alter table public.reply_drafts enable row level security;
alter table public.notification_records enable row level security;
alter table public.schedule_occurrences enable row level security;

-- Operational writes are API/worker only. Owners may inspect their records.
create policy automation_settings_owner_read on public.automation_settings for select to authenticated using (public.owns_brand(brand_id));
create policy background_jobs_owner_read on public.background_jobs for select to authenticated using (public.owns_brand(brand_id));
create policy draft_approvals_owner_read on public.draft_approvals for select to authenticated using (exists (select 1 from public.content_drafts d where d.id = draft_id and public.owns_brand(d.brand_id)));
create policy provider_attempts_owner_read on public.provider_attempts for select to authenticated using (public.owns_brand(brand_id));
create policy reply_drafts_owner_read on public.reply_drafts for select to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and public.owns_brand(c.brand_id)));
create policy notification_records_owner_read on public.notification_records for select to authenticated using (public.owns_brand(brand_id));
create policy schedule_occurrences_owner_read on public.schedule_occurrences for select to authenticated using (public.owns_brand(brand_id));

revoke all on public.automation_settings, public.background_jobs, public.draft_approvals, public.webhook_events, public.provider_attempts, public.reply_drafts, public.notification_records, public.schedule_occurrences from anon, authenticated;
