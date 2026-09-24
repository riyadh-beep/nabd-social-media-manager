begin;
alter table public.content_drafts add column if not exists provider_metrics jsonb;
alter table public.content_drafts add column if not exists metrics_updated_at timestamptz;
alter function public.sma_finish_job(uuid,uuid,jsonb,text) rename to sma_finish_job_idempotent;
create function public.sma_finish_job(p_job uuid,p_lease uuid,p_result jsonb,p_error text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.automation_jobs;p jsonb;
begin
 perform public.sma_finish_job_idempotent(p_job,p_lease,p_result,p_error);
 select * into j from public.automation_jobs where id=p_job;
 if j.kind='reconcile' and p_error is null then
  for p in select value from jsonb_array_elements(coalesce(p_result->'posts','[]')) loop
   if jsonb_typeof(p->'metrics')='array' then
    update public.content_drafts set provider_metrics=p->'metrics',metrics_updated_at=coalesce((p->>'metricsUpdatedAt')::timestamptz,now()) where brand_id=j.brand_id and provider_post_id=p->>'id';
   end if;
  end loop;
 end if;
end $$;
revoke all on function public.sma_finish_job(uuid,uuid,jsonb,text),public.sma_finish_job_idempotent(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sma_finish_job(uuid,uuid,jsonb,text) to service_role;
alter function public.sma_maintenance() rename to sma_maintenance_notifications;
create function public.sma_maintenance() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 result:=public.sma_maintenance_notifications();
 insert into public.automation_jobs(brand_id,kind,payload,idempotency_key)
 select distinct brand_id,'reconcile','{}','metrics:'||floor(extract(epoch from now())/21600)::text from public.content_drafts where status='published' and created_at>now()-interval '30 days' and provider_post_id is not null on conflict do nothing;
 return result;
end $$;
revoke all on function public.sma_maintenance(),public.sma_maintenance_notifications() from public,anon,authenticated;
grant execute on function public.sma_maintenance() to service_role;
commit;
