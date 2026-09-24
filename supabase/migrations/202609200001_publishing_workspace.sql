-- Archive old workspace history without removing provider references or deduplication records.
alter table public.content_drafts add column if not exists archived_at timestamptz;
alter table public.background_jobs add column if not exists archived_at timestamptz;
alter table public.conversations add column if not exists archived_at timestamptz;
alter table public.content_drafts add column if not exists external_post_url text;

-- Existing backend source-approval commands already write these audit records.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
grant all on public.audit_logs to service_role;
