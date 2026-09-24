-- Auto-send is explicitly enabled through the owner command, not by migration.
alter table public.background_jobs drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs add constraint background_jobs_kind_check check(kind in ('content.generate','image.generate','publish.submit','publish.reconcile','inbox.process','reply.generate','reply.send','notification.deliver','knowledge.import'));
alter table public.knowledge_items add column if not exists import_job_id uuid unique references public.background_jobs(id);
