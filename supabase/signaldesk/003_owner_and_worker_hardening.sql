begin;
-- Only the configured owner is provisioned, and only after email verification.
create or replace function public.sma_provision_verified_owner() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if lower(new.email)='riyadh@mabda.ai' and new.email_confirmed_at is not null then
  insert into public.profiles(id,email,display_name,role) values(new.id,new.email,'Riyadh','owner') on conflict(id) do nothing;
 end if;
 return new;
end $$;
create trigger sma_owner_after_confirmation after insert or update of email_confirmed_at on auth.users for each row execute function public.sma_provision_verified_owner();
revoke all on function public.sma_provision_verified_owner() from public,anon,authenticated;
insert into public.profiles(id,email,display_name,role) select id,email,'Riyadh','owner' from auth.users where lower(email)='riyadh@mabda.ai' and email_confirmed_at is not null on conflict(id) do nothing;

-- Record completed outcomes idempotently, but never retry external sends.
alter function public.sma_finish_job(uuid,uuid,jsonb,text) rename to sma_finish_job_once;
create function public.sma_finish_job(p_job uuid,p_lease uuid,p_result jsonb,p_error text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.automation_jobs;
begin
 select * into j from public.automation_jobs where id=p_job for update;
 if j.lease_token is distinct from p_lease then raise exception 'Job lease is invalid';end if;
 if j.status='completed' and j.result=p_result and p_error is null then return;end if;
 if j.status in ('failed','needs_review') and p_error is not null then return;end if;
 perform public.sma_finish_job_once(p_job,p_lease,p_result,p_error);
end $$;
revoke all on function public.sma_finish_job(uuid,uuid,jsonb,text),public.sma_finish_job_once(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sma_finish_job(uuid,uuid,jsonb,text) to service_role;

create or replace function public.sma_maintenance() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 update public.automation_jobs set status=case when kind in ('publish','reply') then 'needs_review' else 'failed' end,error_summary='Worker lease expired. Review before retrying.',updated_at=now() where status='processing' and lease_until<now();
 insert into public.automation_jobs(brand_id,kind,payload,idempotency_key)
 select distinct brand_id,'reconcile','{}','reconcile:'||floor(extract(epoch from now())/900)::text from public.content_drafts where status='scheduled' and provider_post_id is not null on conflict do nothing;
 get diagnostics n=row_count;
 return jsonb_build_object('reconciliation_jobs',n,'unresolved_failures',(select count(*) from public.automation_jobs where status in ('failed','needs_review')));
end $$;
revoke all on function public.sma_maintenance() from public,anon,authenticated;
grant execute on function public.sma_maintenance() to service_role;
commit;
