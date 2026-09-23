-- Per-workspace controls for the AI inbox. The browser can change settings
-- only through authenticated backend commands; actual provider keys stay server-side.
alter table public.automation_settings
  add column if not exists reply_model text,
  add column if not exists reply_knowledge_mode text not null default 'chat'
    check (reply_knowledge_mode in ('chat','content','all'));

create index if not exists knowledge_items_reply_scope_idx
  on public.knowledge_items (brand_id, scope, status, updated_at desc);
