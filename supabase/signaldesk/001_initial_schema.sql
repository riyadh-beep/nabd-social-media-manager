create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now()
);

create table if not exists public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  languages text[] not null default array['ar','en'],
  timezone text not null default 'Asia/Riyadh',
  brand_rules jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_profiles(id) on delete cascade,
  type text not null check (type in ('product','faq','policy','design','source','instruction')),
  title text not null,
  content text not null,
  source text,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_profiles(id) on delete cascade,
  storage_path text not null,
  asset_type text not null check (asset_type in ('product','logo','reference','generated','preview')),
  mime_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_profiles(id) on delete cascade,
  provider text not null check (provider in ('instagram','tiktok','x')),
  external_account_id text,
  connection_status text not null default 'unavailable' check (connection_status in ('connected','degraded','unavailable','paused')),
  last_checked_at timestamptz,
  unique (brand_id, provider)
);

create table if not exists public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram','tiktok','x')),
  language text not null check (language in ('ar','en')),
  caption text not null,
  hashtags text[] not null default '{}',
  visual_brief text not null default '',
  asset_id uuid references public.assets(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','approved','scheduled','published','failed','cancelled')),
  approval_version integer not null default 1,
  scheduled_at timestamptz,
  provider_post_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  provider text not null check (provider in ('instagram','tiktok','x')),
  idempotency_key text not null,
  provider_post_id text,
  status text not null default 'processing' check (status in ('processing','completed','failed','dead_letter')),
  attempt_count integer not null default 0,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, idempotency_key)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_profiles(id) on delete cascade,
  provider text not null check (provider in ('instagram','tiktok','x')),
  external_conversation_id text not null,
  status text not null default 'open' check (status in ('open','resolved','paused')),
  paused_for_human boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_conversation_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  external_message_id text not null,
  sender_type text not null check (sender_type in ('customer','assistant','owner')),
  body text not null,
  language text check (language in ('ar','en')),
  created_at timestamptz not null default now(),
  unique (conversation_id, external_message_id)
);

create table if not exists public.escalations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  reason text not null,
  owner_reply text,
  status text not null default 'open' check (status in ('open','replied','resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.metrics (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  provider text not null,
  metric_date date not null,
  impressions integer,
  likes integer,
  comments integer,
  shares integer,
  source_updated_at timestamptz not null default now(),
  unique (draft_id, provider, metric_date)
);

create table if not exists public.ops_runs (
  run_id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  execution_id text,
  trigger_type text,
  status text not null check (status in ('started','success','failed','dead_letter')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  idempotency_key text,
  error_class text,
  error_summary text,
  payload_excerpt text
);

create table if not exists public.ops_idempotency (
  workflow_key text not null,
  idempotency_key text not null,
  run_id uuid references public.ops_runs(run_id) on delete set null,
  status text not null check (status in ('processing','completed','failed')),
  attempt_count integer not null default 1,
  result_ref text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz,
  last_error_class text,
  primary key (workflow_key, idempotency_key)
);

create table if not exists public.ops_dead_letters (
  dead_letter_id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  run_id uuid references public.ops_runs(run_id) on delete set null,
  idempotency_key text,
  failed_node text,
  attempts integer not null default 0,
  error_class text,
  error_summary text,
  payload_excerpt text,
  review_status text not null default 'pending' check (review_status in ('pending','reviewed','replayed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.ops_heartbeats (
  workflow_key text not null,
  schedule_key text not null,
  expected_interval_minutes integer not null,
  grace_minutes integer not null default 15,
  last_seen_at timestamptz,
  last_run_id uuid references public.ops_runs(run_id) on delete set null,
  status text not null default 'unknown' check (status in ('healthy','late','unknown')),
  alerted_at timestamptz,
  primary key (workflow_key, schedule_key)
);

create index if not exists knowledge_brand_status_idx on public.knowledge_items (brand_id, status);
create index if not exists drafts_brand_status_idx on public.content_drafts (brand_id, status, scheduled_at);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index if not exists escalations_status_idx on public.escalations (status, created_at);

alter table public.profiles enable row level security;
alter table public.brand_profiles enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.assets enable row level security;
alter table public.social_accounts enable row level security;
alter table public.content_drafts enable row level security;
alter table public.publish_jobs enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.escalations enable row level security;
alter table public.metrics enable row level security;
alter table public.ops_runs enable row level security;
alter table public.ops_idempotency enable row level security;
alter table public.ops_dead_letters enable row level security;
alter table public.ops_heartbeats enable row level security;

create or replace function public.is_owner() returns boolean
language sql stable security invoker set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner') $$;

create or replace function public.owns_brand(target_brand_id uuid) returns boolean
language sql stable security invoker set search_path = public
as $$ select exists (select 1 from public.brand_profiles b where b.id = target_brand_id and b.owner_id = (select auth.uid())) $$;

create policy profiles_self on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy brands_owner on public.brand_profiles for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy knowledge_owner on public.knowledge_items for all to authenticated using (public.owns_brand(brand_id)) with check (public.owns_brand(brand_id));
create policy assets_owner on public.assets for all to authenticated using (public.owns_brand(brand_id)) with check (public.owns_brand(brand_id));
create policy social_accounts_owner on public.social_accounts for all to authenticated using (public.owns_brand(brand_id)) with check (public.owns_brand(brand_id));
create policy drafts_owner on public.content_drafts for all to authenticated using (public.owns_brand(brand_id)) with check (public.owns_brand(brand_id));
create policy publish_jobs_owner on public.publish_jobs for select to authenticated using (exists (select 1 from public.content_drafts d where d.id = draft_id and public.owns_brand(d.brand_id)));
create policy conversations_owner on public.conversations for all to authenticated using (public.owns_brand(brand_id)) with check (public.owns_brand(brand_id));
create policy messages_owner on public.messages for select to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and public.owns_brand(c.brand_id)));
create policy escalations_owner on public.escalations for all to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and public.owns_brand(c.brand_id))) with check (exists (select 1 from public.conversations c where c.id = conversation_id and public.owns_brand(c.brand_id)));
create policy metrics_owner on public.metrics for select to authenticated using (exists (select 1 from public.content_drafts d where d.id = draft_id and public.owns_brand(d.brand_id)));

revoke all on public.ops_runs, public.ops_idempotency, public.ops_dead_letters, public.ops_heartbeats from anon, authenticated;

insert into storage.buckets (id, name, public) values
  ('brand-assets', 'brand-assets', false),
  ('generated-assets', 'generated-assets', false),
  ('post-previews', 'post-previews', false)
on conflict (id) do nothing;

create policy storage_owner_read on storage.objects for select to authenticated using (bucket_id in ('brand-assets','generated-assets','post-previews') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_owner_write on storage.objects for insert to authenticated with check (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
