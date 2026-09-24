-- Additive AI inbox support. All mutations remain backend commands.
alter table public.knowledge_items add column if not exists scope text not null default 'content' check (scope in ('content','chat'));
alter table public.conversations add column if not exists customer_username text,
  add column if not exists customer_name text;
alter table public.reply_drafts add column if not exists source_message_id uuid references public.messages(id),
  add column if not exists source_knowledge_ids uuid[] not null default '{}',
  add column if not exists model text,
  add column if not exists needs_human boolean not null default true,
  add column if not exists review_reason text,
  add column if not exists generation_job_id uuid unique references public.background_jobs(id);
alter table public.background_jobs drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs add constraint background_jobs_kind_check check (kind in ('content.generate','image.generate','publish.submit','publish.reconcile','inbox.process','reply.generate','reply.send','notification.deliver'));
create index if not exists reply_drafts_conversation_created_idx on public.reply_drafts(conversation_id,created_at desc);
grant all on public.reply_drafts to service_role;
