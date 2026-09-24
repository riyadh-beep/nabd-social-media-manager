begin;
alter table public.automation_jobs drop constraint automation_jobs_kind_check;
alter table public.automation_jobs add constraint automation_jobs_kind_check check(kind in ('generate','image','publish','sync','inbox_sync','reply','reconcile','notify'));
alter function public.sma_draft_action(uuid,text,integer,jsonb) rename to sma_draft_action_checked;
create function public.sma_draft_action(p_draft uuid,p_action text,p_version integer,p_changes jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.content_drafts;a public.assets;
begin
 select * into d from public.content_drafts where id=p_draft for update;
 perform public.sma_assert_owner(d.brand_id);
 if p_action='approve' and d.platform='tiktok' then raise exception 'TikTok drafts are ready for manual publishing in Buffer. The current Buffer API does not support automatic TikTok posts.';end if;
 if p_action='edit' and p_changes ? 'asset_id' then
  select * into a from public.assets where id=(p_changes->>'asset_id')::uuid and brand_id=d.brand_id and status<>'archived';
  if not found then raise exception 'Choose an image belonging to this workspace';end if;
 end if;
 perform public.sma_draft_action_checked(p_draft,p_action,p_version,p_changes);
 if p_action='edit' and p_changes ? 'asset_id' then update public.content_drafts set asset_id=a.id where id=d.id;end if;
end $$;
revoke all on function public.sma_draft_action(uuid,text,integer,jsonb),public.sma_draft_action_checked(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sma_draft_action(uuid,text,integer,jsonb) to authenticated;

alter function public.sma_maintenance() rename to sma_maintenance_base;
create function public.sma_maintenance() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 result:=public.sma_maintenance_base();
 insert into public.automation_jobs(brand_id,kind,payload,idempotency_key)
 select distinct c.brand_id,'notify',jsonb_build_object('conversation_id',c.id),'notify:'||c.id||':'||(now() at time zone 'Asia/Riyadh')::date
 from public.escalations e join public.conversations c on c.id=e.conversation_id where e.status='open' and e.created_at>now()-interval '1 day' on conflict do nothing;
 return result;
end $$;
revoke all on function public.sma_maintenance(),public.sma_maintenance_base() from public,anon,authenticated;
grant execute on function public.sma_maintenance() to service_role;
commit;
