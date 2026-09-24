-- Apply after 001_initial_schema.sql. All browser mutations are ownership checked.
begin;
alter table public.brand_profiles add column if not exists workspace_type text not null default 'store' check (workspace_type in ('store','creator','business','news'));
alter table public.brand_profiles add column if not exists topics text[] not null default '{}';
alter table public.brand_profiles add column if not exists audience text not null default '';
alter table public.brand_profiles add column if not exists daily_generation boolean not null default false;
alter table public.content_drafts add column if not exists source_facts text[] not null default '{}';
alter table public.content_drafts add column if not exists generation_job_id uuid;
alter table public.content_drafts add column if not exists provider_url text;
create unique index if not exists sma_generated_post_unique on public.content_drafts(generation_job_id,platform) where generation_job_id is not null;

create table if not exists public.automation_jobs (
 id uuid primary key default gen_random_uuid(),
 brand_id uuid not null references public.brand_profiles(id) on delete cascade,
 kind text not null check(kind in ('generate','image','publish','sync','inbox_sync','reply','reconcile')),
 status text not null default 'queued' check(status in ('queued','processing','completed','failed','needs_review','cancelled')),
 payload jsonb not null default '{}', result jsonb,
 idempotency_key text not null, attempts integer not null default 0,
 lease_token uuid, execution_id text, lease_until timestamptz,
 not_before timestamptz not null default now(), error_summary text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(brand_id,kind,idempotency_key)
);
create index if not exists sma_job_queue on public.automation_jobs(kind,status,not_before);
alter table public.automation_jobs enable row level security;
drop policy if exists jobs_owner_read on public.automation_jobs;
create policy jobs_owner_read on public.automation_jobs for select to authenticated using(public.owns_brand(brand_id));
revoke all on public.automation_jobs from anon,authenticated;
grant select on public.automation_jobs to authenticated;
grant all on public.automation_jobs to service_role;

-- Replace broad policies that allowed browser users to bypass approval or self-enrol.
drop policy if exists profiles_self on public.profiles;
create policy profiles_read_self on public.profiles for select to authenticated using(id=auth.uid());
revoke insert,update,delete on public.profiles from authenticated;
drop policy if exists brands_owner on public.brand_profiles;
create policy brands_read_owner on public.brand_profiles for select to authenticated using(owner_id=auth.uid() and public.is_owner());
revoke insert,update,delete on public.brand_profiles from authenticated;
drop policy if exists drafts_owner on public.content_drafts;
create policy drafts_read_owner on public.content_drafts for select to authenticated using(public.owns_brand(brand_id));
revoke insert,update,delete on public.content_drafts from authenticated;
drop policy if exists social_accounts_owner on public.social_accounts;
create policy accounts_read_owner on public.social_accounts for select to authenticated using(public.owns_brand(brand_id));
revoke insert,update,delete on public.social_accounts from authenticated;
drop policy if exists conversations_owner on public.conversations;
create policy conversations_read_owner on public.conversations for select to authenticated using(public.owns_brand(brand_id));
revoke insert,update,delete on public.conversations from authenticated;
drop policy if exists escalations_owner on public.escalations;
create policy escalations_read_owner on public.escalations for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and public.owns_brand(c.brand_id)));
revoke insert,update,delete on public.escalations from authenticated;

create or replace function public.sma_assert_owner(p_brand uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from public.brand_profiles b join public.profiles p on p.id=b.owner_id where b.id=p_brand and p.id=auth.uid() and p.role='owner') then
  raise exception 'Owner access required' using errcode='42501';
 end if;
end $$;

create or replace function public.sma_create_workspace(p_name text,p_type text,p_description text,p_topics text[],p_audience text,p_languages text[]) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='owner') then raise exception 'Owner access required' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 100 or p_type is null or p_type not in ('store','creator','business','news') or coalesce(length(p_description),0)>3000 or coalesce(length(p_audience),0)>500 or cardinality(p_topics)>20 or cardinality(p_languages) not between 1 and 2 or not p_languages <@ array['ar','en'] then raise exception 'Invalid workspace';end if;
 insert into public.brand_profiles(owner_id,name,description,workspace_type,topics,audience,languages,status)
 values(auth.uid(),trim(p_name),coalesce(p_description,''),p_type,coalesce(p_topics,'{}'),coalesce(p_audience,''),p_languages,'approved') returning id into v_id;
 return v_id;
end $$;

create or replace function public.sma_update_workspace(p_brand uuid,p_changes jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.sma_assert_owner(p_brand);
 if p_changes ? 'name' and length(trim(p_changes->>'name')) not between 1 and 100 then raise exception 'Invalid name';end if;
 if length(coalesce(p_changes->>'description',''))>3000 or length(coalesce(p_changes->>'audience',''))>500 then raise exception 'Workspace description too long';end if;
 update public.brand_profiles set name=coalesce(p_changes->>'name',name),description=coalesce(p_changes->>'description',description),workspace_type=coalesce(p_changes->>'workspace_type',workspace_type),
 topics=case when p_changes ? 'topics' then array(select jsonb_array_elements_text(p_changes->'topics')) else topics end,
 audience=coalesce(p_changes->>'audience',audience),daily_generation=coalesce((p_changes->>'daily_generation')::boolean,daily_generation),status=coalesce(p_changes->>'status',status),updated_at=now() where id=p_brand;
end $$;

create or replace function public.sma_enqueue(p_brand uuid,p_kind text,p_payload jsonb,p_request uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_key text;v_payload jsonb;v_draft public.content_drafts;
begin
 perform public.sma_assert_owner(p_brand);
 if p_request is null or p_kind is null or p_kind not in ('generate','image','sync','inbox_sync','reply') then raise exception 'Unsupported action';end if;
 if (select status from public.brand_profiles where id=p_brand)='paused' and p_kind not in ('sync','inbox_sync') then raise exception 'Workspace is paused';end if;
 if length(p_payload::text)>20000 then raise exception 'Request too large';end if;
 select id into v_id from public.automation_jobs where brand_id=p_brand and kind=p_kind and idempotency_key=p_request::text;
 if found then return v_id;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_brand::text,0));
 if (select count(*) from public.automation_jobs where brand_id=p_brand and created_at>now()-interval '1 hour')>=30 then raise exception 'Hourly job limit reached';end if;
 v_key:=p_request::text;
 if p_kind='generate' then
  if jsonb_typeof(p_payload->'platforms') is distinct from 'array' or jsonb_array_length(p_payload->'platforms') not between 1 and 3 or exists(select 1 from jsonb_array_elements_text(p_payload->'platforms') p where p not in ('instagram','tiktok','x')) or coalesce(p_payload->>'language','') not in ('ar','en') or length(trim(coalesce(p_payload->>'brief',''))) not between 1 and 2000 then raise exception 'Invalid generation request';end if;
  if not exists(select 1 from public.knowledge_items where brand_id=p_brand and status='approved') then raise exception 'Add and approve knowledge before generating content';end if;
  v_payload:=jsonb_build_object('platforms',p_payload->'platforms','language',p_payload->>'language','brief',p_payload->>'brief');
 elsif p_kind='image' then
  select * into v_draft from public.content_drafts where id=(p_payload->>'draft_id')::uuid and brand_id=p_brand for update;
  if not found or v_draft.status<>'draft' or v_draft.approval_version<>(p_payload->>'version')::integer then raise exception 'Draft changed; refresh and try again';end if;
  v_payload:=jsonb_build_object('draft_id',v_draft.id,'version',v_draft.approval_version);v_key:='image:'||v_draft.id||':'||v_draft.approval_version;
 elsif p_kind='reply' then
  if length(trim(coalesce(p_payload->>'text',''))) not between 1 and 4000 or not exists(select 1 from public.conversations where id=(p_payload->>'conversation_id')::uuid and brand_id=p_brand) then raise exception 'Invalid reply';end if;
  v_payload:=jsonb_build_object('conversation_id',p_payload->>'conversation_id','text',trim(p_payload->>'text'));
 else v_payload:='{}';
 end if;
 insert into public.automation_jobs(brand_id,kind,payload,idempotency_key) values(p_brand,p_kind,v_payload,v_key) on conflict(brand_id,kind,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into v_id;
 return v_id;
end $$;

create or replace function public.sma_draft_action(p_draft uuid,p_action text,p_version integer,p_changes jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.content_drafts; v_caption text;
begin
 select * into d from public.content_drafts where id=p_draft for update;
 if not found then raise exception 'Draft not found';end if;
 perform public.sma_assert_owner(d.brand_id);
 if p_version is null or d.approval_version<>p_version then raise exception 'Draft changed; refresh before continuing';end if;
 if d.status in ('scheduled','published') or exists(select 1 from public.automation_jobs where payload->>'draft_id'=d.id::text and kind in ('publish','image') and status in ('processing','needs_review')) then raise exception 'This post is already being processed; review its provider status first';end if;
 if p_action='approve' then
  if d.status<>'draft' then raise exception 'Only draft posts can be approved';end if;
  if (select status from public.brand_profiles where id=d.brand_id)='paused' then raise exception 'Workspace is paused';end if;
  if d.platform in ('instagram','tiktok') and d.asset_id is null then raise exception 'Generate or attach an image before approving this platform';end if;
  if not exists(select 1 from public.social_accounts where brand_id=d.brand_id and provider=d.platform and connection_status='connected' and external_account_id is not null) then raise exception 'Verify the publishing channel before approval';end if;
  update public.content_drafts set status='approved',updated_at=now() where id=d.id;
  insert into public.automation_jobs(brand_id,kind,payload,idempotency_key,not_before) values(d.brand_id,'publish',jsonb_build_object('draft_id',d.id,'version',d.approval_version),d.id||':'||d.approval_version,greatest(coalesce(d.scheduled_at,now()),now())) on conflict do nothing;
 elsif p_action in ('edit','cancel','reject') then
  update public.automation_jobs set status='cancelled',updated_at=now() where kind in ('publish','image') and payload->>'draft_id'=d.id::text and status='queued';
  if p_action='edit' then
   v_caption:=trim(coalesce(p_changes->>'caption',d.caption));
   if length(v_caption) not between 1 and (case when d.platform='x' then 280 else 2200 end) then raise exception 'Invalid caption length';end if;
   update public.content_drafts set caption=v_caption,scheduled_at=case when p_changes ? 'scheduled_at' then (p_changes->>'scheduled_at')::timestamptz else scheduled_at end,status='draft',approval_version=approval_version+1,updated_at=now() where id=d.id;
  else update public.content_drafts set status='cancelled',approval_version=approval_version+1,updated_at=now() where id=d.id;
  end if;
 else raise exception 'Unsupported action';
 end if;
end $$;

-- Service-only worker APIs. Each claim leases one job; an expired send is never retried automatically.
create or replace function public.sma_claim_job(p_kind text,p_execution text) returns setof jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.automation_jobs;b public.brand_profiles;d public.content_drafts;v_context jsonb;
begin
 update public.automation_jobs set status=case when kind in ('publish','reply') then 'needs_review' else 'failed' end,error_summary='Worker lease expired. Check the provider before retrying.',updated_at=now() where status='processing' and lease_until<now();
 select q.* into j from public.automation_jobs q join public.brand_profiles bp on bp.id=q.brand_id where q.kind=p_kind and q.status='queued' and q.not_before<=now() and (bp.status<>'paused' or q.kind in ('sync','inbox_sync','reconcile')) order by q.created_at for update of q skip locked limit 1;
 if not found then return;end if;
 update public.automation_jobs set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',execution_id=p_execution,attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
 select * into b from public.brand_profiles where id=j.brand_id;
 v_context:=jsonb_build_object('job',to_jsonb(j),'brand',to_jsonb(b),'knowledge',coalesce((select jsonb_agg(to_jsonb(k)) from public.knowledge_items k where k.brand_id=b.id and k.status='approved'),'[]'::jsonb),'recent_posts',coalesce((select jsonb_agg(x) from (select caption,platform,created_at from public.content_drafts where brand_id=b.id order by created_at desc limit 12)x),'[]'::jsonb));
 if j.kind in ('image','publish') then
  select * into d from public.content_drafts where id=(j.payload->>'draft_id')::uuid and brand_id=b.id;
  if not found or d.approval_version<>(j.payload->>'version')::integer or (j.kind='publish' and d.status<>'approved') or (j.kind='image' and d.status<>'draft') then
   update public.automation_jobs set status='cancelled',error_summary='Draft was changed before processing',updated_at=now() where id=j.id;return;
  end if;
  v_context:=v_context||jsonb_build_object('draft',to_jsonb(d),'account',(select to_jsonb(a) from public.social_accounts a where a.brand_id=b.id and a.provider=d.platform),'asset',(select to_jsonb(a) from public.assets a where a.id=d.asset_id));
 elsif j.kind='reply' then
  v_context:=v_context||jsonb_build_object('conversation',(select to_jsonb(c) from public.conversations c where c.id=(j.payload->>'conversation_id')::uuid and c.brand_id=b.id));
 end if;
 return next v_context;
end $$;

create or replace function public.sma_finish_job(p_job uuid,p_lease uuid,p_result jsonb,p_error text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.automation_jobs;p jsonb;a jsonb;v_asset uuid;v_chat uuid;v_message uuid;v_post uuid;
begin
 select * into j from public.automation_jobs where id=p_job and lease_token=p_lease and status='processing' for update;
 if not found then raise exception 'Job lease is invalid or already completed';end if;
 if p_error is not null then
  update public.automation_jobs set status=case when kind in ('publish','reply') then 'needs_review' else 'failed' end,error_summary=left(p_error,500),lease_until=null,updated_at=now() where id=j.id;return;
 end if;
 if j.kind='generate' then
  if jsonb_typeof(p_result->'posts') is distinct from 'array' or jsonb_array_length(p_result->'posts') not between 1 and 3 then raise exception 'Invalid agent output';end if;
  for p in select value from jsonb_array_elements(p_result->'posts') loop
   if coalesce(p->>'platform','') not in ('instagram','tiktok','x') or not (j.payload->'platforms' ? (p->>'platform')) or coalesce(p->>'language','')<>j.payload->>'language' or length(trim(coalesce(p->>'caption',''))) not between 1 and (case when p->>'platform'='x' then 280 else 2200 end) or jsonb_typeof(p->'source_facts') is distinct from 'array' or jsonb_array_length(p->'source_facts')=0 then raise exception 'Invalid generated post';end if;
   insert into public.content_drafts(brand_id,platform,language,caption,hashtags,visual_brief,source_facts,generation_job_id,status)
   values(j.brand_id,p->>'platform',p->>'language',p->>'caption',array(select jsonb_array_elements_text(coalesce(p->'hashtags','[]'))),coalesce(p->>'visual_brief',''),array(select jsonb_array_elements_text(p->'source_facts')),j.id,'draft') on conflict do nothing;
  end loop;
 elsif j.kind='image' then
  if coalesce(p_result->>'storage_path','')='' then raise exception 'Image upload was not confirmed';end if;
  if p_result->>'storage_path' not like (select owner_id::text||'/'||id::text||'/%' from public.brand_profiles where id=j.brand_id) then raise exception 'Invalid storage path';end if;
  insert into public.assets(brand_id,storage_path,asset_type,mime_type,metadata,status) values(j.brand_id,p_result->>'storage_path','generated','image/jpeg',jsonb_build_object('job_id',j.id),'draft') returning id into v_asset;
  update public.content_drafts set asset_id=v_asset,approval_version=approval_version+1,updated_at=now() where id=(j.payload->>'draft_id')::uuid and brand_id=j.brand_id and approval_version=(j.payload->>'version')::integer and status='draft';
  if not found then raise exception 'Draft changed during image generation';end if;
 elsif j.kind='publish' then
  if coalesce(p_result->>'provider_post_id','')='' then raise exception 'Buffer did not confirm a post ID';end if;
  update public.content_drafts set status='scheduled',provider_post_id=p_result->>'provider_post_id',updated_at=now() where id=(j.payload->>'draft_id')::uuid and brand_id=j.brand_id;
  insert into public.publish_jobs(draft_id,provider,idempotency_key,provider_post_id,status,attempt_count) select id,platform,j.idempotency_key,p_result->>'provider_post_id','completed',1 from public.content_drafts where id=(j.payload->>'draft_id')::uuid on conflict do nothing;
 elsif j.kind='sync' then
  if jsonb_typeof(p_result->'channels') is distinct from 'array' then raise exception 'No channel response';end if;
  update public.social_accounts set connection_status='unavailable',last_checked_at=now() where brand_id=j.brand_id;
  for p in select value from jsonb_array_elements(p_result->'channels') loop
   if p->>'provider' in ('instagram','tiktok','x') and coalesce(p->>'id','')<>'' then
    insert into public.social_accounts(brand_id,provider,external_account_id,connection_status,last_checked_at) values(j.brand_id,p->>'provider',p->>'id',case when coalesce((p->>'connected')::boolean,false) then 'connected' else 'degraded' end,now()) on conflict(brand_id,provider) do update set external_account_id=excluded.external_account_id,connection_status=excluded.connection_status,last_checked_at=now();
   end if;
  end loop;
 elsif j.kind='inbox_sync' then
  for p in select value from jsonb_array_elements(coalesce(p_result->'messages','[]')) loop
   if coalesce(p->>'chat_id','')='' or coalesce(p->>'id','')='' then continue;end if;
   insert into public.conversations(brand_id,provider,external_conversation_id,status,paused_for_human) values(j.brand_id,'instagram',p->>'chat_id','open',true) on conflict(provider,external_conversation_id) do update set updated_at=now() where conversations.brand_id=j.brand_id returning id into v_chat;
   if v_chat is null then continue;end if;
   insert into public.messages(conversation_id,external_message_id,sender_type,body,created_at) values(v_chat,p->>'id',case when coalesce((p->>'is_sender')::boolean,false) then 'owner' else 'customer' end,coalesce(p->>'text','[Attachment]'),coalesce((p->>'timestamp')::timestamptz,now())) on conflict do nothing returning id into v_message;
   if v_message is not null and not coalesce((p->>'is_sender')::boolean,false) then
    insert into public.escalations(conversation_id,message_id,reason,status) values(v_chat,v_message,'Owner review required','open');
   end if;
  end loop;
 elsif j.kind='reply' then
  if coalesce(p_result->>'message_id','')='' then raise exception 'Unipile did not confirm delivery';end if;
  insert into public.messages(conversation_id,external_message_id,sender_type,body) values((j.payload->>'conversation_id')::uuid,p_result->>'message_id','owner',j.payload->>'text') on conflict do nothing;
  update public.escalations set status='replied',owner_reply=j.payload->>'text',resolved_at=now() where conversation_id=(j.payload->>'conversation_id')::uuid and status='open';
 elsif j.kind='reconcile' then
  for p in select value from jsonb_array_elements(coalesce(p_result->'posts','[]')) loop
   update public.content_drafts set status=case p->>'status' when 'sent' then 'published' when 'error' then 'failed' else status end,provider_url=p->>'url',updated_at=now() where brand_id=j.brand_id and provider_post_id=p->>'id';
  end loop;
 end if;
 update public.automation_jobs set status='completed',result=p_result,lease_until=null,updated_at=now() where id=j.id;
end $$;

create or replace function public.sma_daily_jobs() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 insert into public.automation_jobs(brand_id,kind,payload,idempotency_key)
 select id,'generate',jsonb_build_object('brief','Create a fresh, useful post from approved facts and topics. Avoid repeating recent posts.','platforms',jsonb_build_array('x'),'language',languages[1]),'daily:'||(now() at time zone 'Asia/Riyadh')::date from public.brand_profiles b where daily_generation and status='approved' and exists(select 1 from public.knowledge_items k where k.brand_id=b.id and k.status='approved') on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;

-- PostgreSQL grants new functions to PUBLIC by default: explicitly remove that access.
revoke all on function public.sma_assert_owner(uuid),public.sma_create_workspace(text,text,text,text[],text,text[]),public.sma_update_workspace(uuid,jsonb),public.sma_enqueue(uuid,text,jsonb,uuid),public.sma_draft_action(uuid,text,integer,jsonb),public.sma_claim_job(text,text),public.sma_finish_job(uuid,uuid,jsonb,text),public.sma_daily_jobs() from public,anon,authenticated;
grant execute on function public.sma_create_workspace(text,text,text,text[],text,text[]),public.sma_update_workspace(uuid,jsonb),public.sma_enqueue(uuid,text,jsonb,uuid),public.sma_draft_action(uuid,text,integer,jsonb) to authenticated;
grant execute on function public.sma_claim_job(text,text),public.sma_finish_job(uuid,uuid,jsonb,text),public.sma_daily_jobs() to service_role;
commit;
