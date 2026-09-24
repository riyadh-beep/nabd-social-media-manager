-- Seven private product photos per knowledge item. Commands are backend-only.
create table if not exists public.knowledge_photos (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null references public.knowledge_items(id) on delete cascade,
  asset_id uuid not null references public.assets(id),
  slot smallint not null check (slot between 1 and 7),
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (knowledge_id,slot),
  unique (knowledge_id,content_hash)
);
alter table public.knowledge_photos enable row level security;
revoke all on public.knowledge_photos from public,anon,authenticated;
grant all on public.knowledge_photos to service_role;
