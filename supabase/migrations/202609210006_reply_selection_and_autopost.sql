-- Saved per-workspace choices. These are controlled only by authenticated API
-- commands; provider credentials remain server-side.
alter table public.automation_settings
  add column if not exists reply_knowledge_ids uuid[] not null default '{}',
  add column if not exists last_content_settings jsonb,
  add column if not exists last_auto_post_at timestamptz;

create index if not exists automation_settings_reply_knowledge_ids_idx
  on public.automation_settings using gin (reply_knowledge_ids);
