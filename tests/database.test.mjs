import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { claimJob, enqueueJob, retryImageJob } from '../packages/domain/src/jobs.ts';
const owner='11111111-1111-4111-8111-111111111111',stranger='22222222-2222-4222-8222-222222222222';
let db,brand,draft;
test.before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean);
 create table storage.objects(id uuid,name text,bucket_id text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
 grant usage on schema public,auth,storage to authenticated,anon,service_role;
 grant execute on function auth.uid() to public;`);
 const base=await readFile(new URL('../supabase/signaldesk/001_initial_schema.sql',import.meta.url),'utf8');
 await db.exec(base.replace('create extension if not exists pgcrypto;',''));
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated; grant all on all tables in schema public to service_role;');
 await db.exec(await readFile(new URL('../supabase/signaldesk/002_signaldesk_workspaces.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/signaldesk/003_owner_and_worker_hardening.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/signaldesk/004_notifications_and_publish_guards.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/signaldesk/005_provider_metrics.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202609190002_custom_backend_foundation.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202609190003_social_connection_metadata.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202609200001_publishing_workspace.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202609200002_nabd_ai_inbox.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202609200003_auto_replies_imports.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202609200004_knowledge_photos.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202609200005_photo_grounded_drafts.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202609210005_inbox_controls.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202609210006_reply_selection_and_autopost.sql',import.meta.url),'utf8'));
 await db.query('insert into auth.users(id) values($1),($2)',[owner,stranger]);
 await db.query('insert into public.profiles(id,email) values($1,$2)',[owner,'owner@example.test']);
});
test.after(async()=>db?.close());
async function as(role,id,fn){await db.exec(`set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}}
async function rpc(name,args){const p=args.map((_,i)=>`$${i+1}`).join(',');return (await db.query(`select public.${name}(${p}) as value`,args)).rows[0]?.value;}
test('non-owner cannot self-enrol or create a workspace',async()=>{
 await as('authenticated',stranger,async()=>{
  await assert.rejects(()=>db.query('insert into profiles(id,email) values($1,$2)',[stranger,'x@example.test']),/permission denied/);
  await assert.rejects(()=>rpc('sma_create_workspace',['Bad','news','',[], '',['en']]),/Owner access/);
 });
});
test('only the configured owner is provisioned after email verification',async()=>{
 const id=crypto.randomUUID();
 await db.query('insert into auth.users(id,email) values($1,$2)',[id,'riyadh@mabda.ai']);
 assert.equal((await db.query('select id from profiles where id=$1',[id])).rows.length,0);
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[id]);
 assert.equal((await db.query('select role from profiles where id=$1',[id])).rows[0].role,'owner');
 await db.query('update auth.users set email=$2,email_confirmed_at=now() where id=$1',[stranger,'stranger@example.test']);
 assert.equal((await db.query('select id from profiles where id=$1',[stranger])).rows.length,0);
});
test('owner creates an AI news workspace without a store URL',async()=>{
 brand=await as('authenticated',owner,()=>rpc('sma_create_workspace',['The AI Edit','news','Practical AI news',['AI research'],'Founders',['en']]));
 assert.match(brand,/^[0-9a-f-]{36}$/);
 const b=(await db.query('select * from brand_profiles where id=$1',[brand])).rows[0];assert.equal(b.workspace_type,'news');
});
test('cross-owner data and worker RPCs are inaccessible',async()=>{
 await as('authenticated',stranger,async()=>{
  assert.equal((await db.query('select * from brand_profiles')).rows.length,0);
  await assert.rejects(()=>rpc('sma_update_workspace',[brand,{status:'paused'}]),/Owner access/);
  await assert.rejects(()=>rpc('sma_claim_job',['generate','unauthorized']),/permission denied/);
 });
});
test('generation requires approved knowledge and valid platforms',async()=>{
 await as('authenticated',owner,async()=>{
  await assert.rejects(()=>rpc('sma_enqueue',[brand,'generate',{platforms:['x'],language:'en',brief:'A useful update'},crypto.randomUUID()]),/approve knowledge/);
  await db.query("insert into knowledge_items(brand_id,type,title,content,status) values($1,'source','Example update','Verified test fact','approved')",[brand]);
  await assert.rejects(()=>rpc('sma_enqueue',[brand,'generate',{platforms:[],language:'en',brief:'test'},crypto.randomUUID()]),/Invalid generation/);
 });
});
test('repeated request IDs enqueue once and a claim cannot run twice',async()=>{
 const request=crypto.randomUUID(),payload={platforms:['x'],language:'en',brief:'A useful update'};
 const first=await as('authenticated',owner,()=>rpc('sma_enqueue',[brand,'generate',payload,request]));
 const second=await as('authenticated',owner,()=>rpc('sma_enqueue',[brand,'generate',payload,request]));assert.equal(first,second);
 const claim=await as('service_role','',()=>rpc('sma_claim_job',['generate','test-1']));assert.equal(claim.job.id,first);
 assert.equal(await as('service_role','',()=>rpc('sma_claim_job',['generate','test-2'])),undefined);
 await as('service_role','',()=>rpc('sma_finish_job',[first,claim.job.lease_token,{posts:[{platform:'x',language:'en',caption:'A useful test fact.',hashtags:[],visual_brief:'',source_facts:['Example update']}]},null]));
 draft=(await db.query('select * from content_drafts where generation_job_id=$1',[first])).rows[0];assert.equal(draft.status,'draft');
 await as('service_role','',()=>rpc('sma_finish_job',[first,claim.job.lease_token,{posts:[{platform:'x',language:'en',caption:'A useful test fact.',hashtags:[],visual_brief:'',source_facts:['Example update']}]},null]));
 assert.equal((await db.query('select id from content_drafts where generation_job_id=$1',[first])).rows.length,1);
 await assert.rejects(()=>as('service_role','',()=>rpc('sma_finish_job',[first,claim.job.lease_token,{posts:[]},null])),/lease/);
});
test('approval cannot bypass channel validation or direct table grants',async()=>{
 await as('authenticated',owner,async()=>{
  await assert.rejects(()=>db.query("update content_drafts set status='approved' where id=$1",[draft.id]),/permission denied/);
  await assert.rejects(()=>rpc('sma_draft_action',[draft.id,'approve',1,{}]),/Verify the publishing channel/);
 });
 await db.query("insert into social_accounts(brand_id,provider,external_account_id,connection_status) values($1,'x','test-channel','connected')",[brand]);
});
test('approval creates one job; edit cancels it and invalidates approval',async()=>{
 await as('authenticated',owner,()=>rpc('sma_draft_action',[draft.id,'approve',1,{}]));
 await assert.rejects(()=>as('authenticated',owner,()=>rpc('sma_draft_action',[draft.id,'approve',1,{}])),/Only draft/);
 assert.equal((await db.query("select * from automation_jobs where kind='publish'")).rows.length,1);
 await as('authenticated',owner,()=>rpc('sma_draft_action',[draft.id,'edit',1,{caption:'Edited fact.'}]));
 const changed=(await db.query('select * from content_drafts where id=$1',[draft.id])).rows[0];assert.equal(changed.status,'draft');assert.equal(changed.approval_version,2);
 assert.equal((await db.query("select status from automation_jobs where kind='publish'")).rows[0].status,'cancelled');
 await assert.rejects(()=>as('authenticated',owner,()=>rpc('sma_draft_action',[draft.id,'approve',1,{}])),/Draft changed/);
});
test('pause stops claims; expired publish leases require human review',async()=>{
 await as('authenticated',owner,()=>rpc('sma_draft_action',[draft.id,'approve',2,{}]));
 await as('authenticated',owner,()=>rpc('sma_update_workspace',[brand,{status:'paused'}]));
 assert.equal(await as('service_role','',()=>rpc('sma_claim_job',['publish','paused-run'])),undefined);
 await as('authenticated',owner,()=>rpc('sma_update_workspace',[brand,{status:'approved'}]));
 const job=await as('service_role','',()=>rpc('sma_claim_job',['publish','send-run']));assert.equal(job.draft.caption,'Edited fact.');
 await db.query("update automation_jobs set lease_until=now()-interval '1 minute' where id=$1",[job.job.id]);
 assert.equal(await as('service_role','',()=>rpc('sma_claim_job',['publish','retry-run'])),undefined);
 assert.equal((await db.query('select status from automation_jobs where id=$1',[job.job.id])).rows[0].status,'needs_review');
 await assert.rejects(()=>as('authenticated',owner,()=>rpc('sma_draft_action',[draft.id,'edit',2,{caption:'Unsafe retry'}])),/already being processed/);
});
test('legacy RPC keeps TikTok disabled and rejects foreign image attachments',async()=>{
 const id=(await db.query("insert into content_drafts(brand_id,platform,language,caption,status) values($1,'tiktok','en','Manual draft','draft') returning id",[brand])).rows[0].id;
 await assert.rejects(()=>as('authenticated',owner,()=>rpc('sma_draft_action',[id,'approve',1,{}])),/manual publishing/);
 await assert.rejects(()=>as('authenticated',owner,()=>rpc('sma_draft_action',[id,'edit',1,{asset_id:crypto.randomUUID()}])),/belonging to this workspace/);
});
test('reconciliation stores confirmed status and real provider metrics',async()=>{
 await db.query("update content_drafts set status='scheduled',provider_post_id='provider-test' where id=$1",[draft.id]);
 await db.query("insert into automation_jobs(brand_id,kind,idempotency_key) values($1,'reconcile','metrics-test')",[brand]);
 const claim=await as('service_role','',()=>rpc('sma_claim_job',['reconcile','metrics-test']));
 await as('service_role','',()=>rpc('sma_finish_job',[claim.job.id,claim.job.lease_token,{posts:[{id:'provider-test',status:'sent',metrics:[{type:'impressions',name:'Impressions',value:42}],metricsUpdatedAt:'2026-09-18T21:00:00Z'}]},null]));
 const result=(await db.query('select status,provider_metrics from content_drafts where id=$1',[draft.id])).rows[0];
 assert.equal(result.status,'published');assert.equal(result.provider_metrics[0].value,42);
});

test('custom queue skips paused and archived jobs and claims each job once',async()=>{
 await db.exec('begin');
 try {
  const active=await enqueueJob(db,{brandId:brand,kind:'publish.submit',payload:{draftId:draft.id},idempotencyKey:'active-fixture'});
  const archived=await enqueueJob(db,{brandId:brand,kind:'publish.submit',payload:{draftId:draft.id},idempotencyKey:'archived-fixture'});
  await db.query('update background_jobs set archived_at=now() where id=$1',[archived]);
  await db.query("update brand_profiles set status='paused' where id=$1",[brand]);
  assert.equal(await claimJob(db,'paused-worker'),null);
  await db.query("update brand_profiles set status='approved' where id=$1",[brand]);
  assert.equal((await claimJob(db,'first-worker')).id,active);
  assert.equal(await claimJob(db,'second-worker'),null);
  assert.equal((await db.query('select status from background_jobs where id=$1',[archived])).rows[0].status,'queued');
 } finally { await db.exec('rollback'); }
});

test('image retries persist a delay, fence leases and stop after three attempts',async()=>{
 await db.exec('begin');
 try {
  const query=async(sql,params)=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
  const id=await enqueueJob(db,{brandId:brand,kind:'image.generate',payload:{draftId:draft.id},idempotencyKey:'retry-fixture'});
  const job=await claimJob(db,'retry-worker');assert.equal(job.id,id);
  await assert.rejects(retryImageJob({query},{...job,lease_token:stranger},'temporary'),/lease/);
  await retryImageJob({query},job,'temporary');
  const saved=(await db.query('select * from background_jobs where id=$1',[id])).rows[0];
  assert.equal(saved.status,'queued');assert.equal(saved.lease_token,null);
  assert.ok(new Date(saved.run_at)>new Date(saved.updated_at));
  assert.equal(await claimJob(db,'too-early'),null);
  await assert.rejects(retryImageJob({query},{...job,attempt_count:3},'temporary'),/limit/);
  await assert.rejects(retryImageJob({query},{...job,kind:'publish.submit'},'temporary'),/limit/);
 }finally{await db.exec('rollback');}
});

test('audit records are backend-only',async()=>{
 await as('authenticated',owner,async()=>{
  await assert.rejects(()=>db.query('select * from audit_logs'),/permission denied/);
  await assert.rejects(()=>db.query("insert into audit_logs(actor_id,action,entity_type,entity_id) values($1,'test','workspace',$2)",[owner,brand]),/permission denied/);
 });
});

test('AI inbox API and worker persist drafts, isolate knowledge, and prevent stale or duplicate replies',async t=>{
 process.env.NODE_ENV='test';process.env.LOG_LEVEL='silent';process.env.SUPABASE_OWNER_USER_ID=owner;
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY='fake-secret-key';
 process.env.DATABASE_URL='postgres://unused:unused@localhost/unused';process.env.OPENROUTER_API_KEY='fake-openrouter-key';
 process.env.UNIPILE_API_KEY='fake-unipile-key';process.env.UNIPILE_DSN='https://unipile.example.test';
 const {database}=await import('../packages/database/src/client.ts');
 const query=async(sql,params)=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
 t.mock.method(database,'query',query);t.mock.method(database,'connect',async()=>({query,release(){}}));
 const {server}=await import('../apps/api/src/server.ts');
 const worker=await import('../apps/worker/src/index.ts');
 const request=(method,url,payload)=>server.inject({method,url,headers:{host:'localhost'},remoteAddress:'127.0.0.1',payload});
 try {
  const added=await request('POST',`/v1/brands/${brand}/knowledge`,{scope:'chat',type:'policy',title:'Store returns',content:'Unopened products can be returned within 14 days.',source:''});
  assert.equal(added.statusCode,201);const knowledge=added.json().knowledge;
  assert.equal(knowledge.status,'draft');assert.equal(knowledge.scope,'chat');
  assert.equal((await request('POST',`/v1/brands/${brand}/knowledge/${knowledge.id}/approve`)).statusCode,200);
  const eventId=(await db.query("insert into webhook_events(provider,external_account_id,event_id,event_type,verified_at,payload) values('unipile','fixture-account','fixture-message','message_received',now(),$1) returning id",[JSON.stringify({chat_id:'fixture-chat',message_id:'fixture-message',message:'Can I return an unopened item?',sender:{attendee_public_identifier:'example_customer',attendee_name:'Example Customer'}})])).rows[0].id;
  await worker.processInboxEvent({brand_id:brand,payload:{webhookEventId:eventId}});
  const conversation=(await db.query("select * from conversations where external_conversation_id='fixture-chat'")).rows[0];
  assert.equal(conversation.customer_username,'example_customer');assert.equal(conversation.paused_for_human,true);
  const generation=(await db.query("select * from background_jobs where kind='reply.generate' and payload->>'conversationId'=$1",[conversation.id])).rows[0];
  assert.ok(generation);
  t.mock.method(globalThis,'fetch',async(_url,init)=>{const body=JSON.parse(init.body);const context=JSON.parse(body.messages[1].content);assert.equal(context.approvedKnowledge.length,1);assert.equal(context.approvedKnowledge[0].id,knowledge.id);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({text:'Unopened items can be returned within 14 days.',sourceKnowledgeIds:[knowledge.id],needsHuman:false,reason:''})}}]}));});
  await worker.processReplyGeneration(generation);
  const suggestion=(await db.query('select * from reply_drafts where conversation_id=$1',[conversation.id])).rows[0];
  assert.equal(suggestion.status,'draft');assert.equal(suggestion.source_knowledge_ids[0],knowledge.id);
  const payload={text:suggestion.body,expectedMessageId:suggestion.source_message_id,replyDraftId:suggestion.id};
  const first=await request('POST',`/v1/brands/${brand}/conversations/${conversation.id}/reply`,payload);
  assert.equal(first.statusCode,202);
  assert.equal((await request('POST',`/v1/brands/${brand}/conversations/${conversation.id}/reply`,payload)).json().jobId,first.json().jobId);
  assert.equal((await db.query("select count(*)::int as n from messages where conversation_id=$1 and sender_type='owner'",[conversation.id])).rows[0].n,0);
  const edited=await request('PATCH',`/v1/brands/${brand}/knowledge/${knowledge.id}`,{scope:'chat',type:'policy',title:'Updated returns',content:'Returns require staff review.',source:''});assert.equal(edited.statusCode,200);
  const staleKnowledge=await request('POST',`/v1/brands/${brand}/conversations/${conversation.id}/reply`,payload);assert.equal(staleKnowledge.statusCode,400);
  await db.query("insert into messages(conversation_id,external_message_id,sender_type,body,created_at) values($1,'new-message','customer','New question',now()+interval '1 second')",[conversation.id]);
  assert.equal((await worker.processReplyGeneration(generation)).state,'superseded');
  const stale=await request('POST',`/v1/brands/${brand}/conversations/${conversation.id}/reply`,payload);assert.equal(stale.statusCode,400);assert.match(stale.json().error,/conversation changed/);
  const denied=await request('POST',`/v1/brands/${stranger}/conversations/${conversation.id}/suggest`);assert.equal(denied.statusCode,403);
  await as('authenticated',stranger,async()=>{await assert.rejects(()=>db.query('select * from reply_drafts'),/permission denied/);});
  await db.query("insert into automation_settings(brand_id,reply_sending_enabled) values($1,true) on conflict(brand_id) do update set reply_sending_enabled=true",[brand]);
  await db.query("update knowledge_items set status='approved' where id=$1",[knowledge.id]);
  const newest=(await db.query("select id from messages where conversation_id=$1 order by created_at desc,id desc limit 1",[conversation.id])).rows[0].id;
  const autoId=await enqueueJob({query},{brandId:brand,kind:'reply.generate',payload:{conversationId:conversation.id,messageId:newest,automatic:true},idempotencyKey:'auto-fixture'});
  const autoGeneration=(await db.query('select * from background_jobs where id=$1',[autoId])).rows[0];
  assert.equal((await worker.processReplyGeneration(autoGeneration)).state,'auto_reply_queued');
  const autoSend=(await db.query("select * from background_jobs where kind='reply.send' and payload->>'automatic'='true'",[])).rows[0];assert.ok(autoSend);
  await db.query("update automation_settings set reply_sending_enabled=false where brand_id=$1",[brand]);
  assert.equal((await worker.processReply(autoSend)).state,'auto_reply_disabled');
  await db.query("update automation_settings set reply_sending_enabled=true where brand_id=$1",[brand]);
  await db.query("insert into social_accounts(brand_id,provider,external_account_id,connection_status,connection_metadata) values($1,'instagram','fake-instagram','connected',$2)",[brand,JSON.stringify({unipile_account_id:'fake-account'})]);
  let deliveries=0;t.mock.method(globalThis,'fetch',async url=>{assert.match(String(url),/unipile\.example\.test/);deliveries++;return new Response(JSON.stringify({message_id:'fake-confirmed-message'}));});
  assert.equal((await worker.processReply(autoSend)).state,'confirmed');
  await worker.processReply(autoSend);assert.equal(deliveries,1);

  await t.test('post generation uses exactly the selected chat knowledge and rejects invalid selections',async()=>{
   const input={brief:'Write a post about our store policy',platforms:['x'],language:'en',knowledgeIds:[knowledge.id]};
   const generatedResponse=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({drafts:[{platform:'x',caption:'Our returns policy is here to help.',hashtags:[],visualBrief:'A clean editorial illustration of a parcel with a return arrow.',sourceFacts:[knowledge.id]}]})}}]}));
   let providerCalls=0;
   t.mock.method(globalThis,'fetch',async(_url,init)=>{providerCalls++;const context=JSON.parse(JSON.parse(init.body).messages[1].content);assert.deepEqual(context.knowledge.map(k=>k.id),[knowledge.id]);return generatedResponse();});
   const added=await request('POST',`/v1/brands/${brand}/generate`,input);assert.equal(added.statusCode,202);
   const job=(await db.query('select * from background_jobs where id=$1',[added.json().jobId])).rows[0];
   assert.deepEqual(job.payload.knowledgeIds,[knowledge.id]);
   const result=await worker.processContentGeneration(job);
   const saved=(await db.query('select source_facts,status from content_drafts where id=$1',[result.draftIds[0]])).rows[0];
   assert.deepEqual(saved.source_facts,[knowledge.id]);assert.equal(saved.status,'draft');assert.equal(providerCalls,1);
   for(const ids of [[],[knowledge.id,knowledge.id],[crypto.randomUUID()],['invalid-id']]){
    assert.equal((await request('POST',`/v1/brands/${brand}/generate`,{...input,knowledgeIds:ids})).statusCode,400);
   }
   const otherBrand=(await request('POST','/v1/brands',{name:'Isolated fixture',workspaceType:'store'})).json().brand.id;
   const otherKnowledge=(await request('POST',`/v1/brands/${otherBrand}/knowledge`,{scope:'chat',type:'faq',title:'Other store',content:'Private to another workspace',source:''})).json().knowledge;
   await request('POST',`/v1/brands/${otherBrand}/knowledge/${otherKnowledge.id}/approve`);
   assert.equal((await request('POST',`/v1/brands/${brand}/generate`,{...input,knowledgeIds:[otherKnowledge.id]})).statusCode,400);
   await db.query("update knowledge_items set status='draft' where id=$1",[knowledge.id]);
   assert.equal((await request('POST',`/v1/brands/${brand}/generate`,input)).statusCode,400);
   await assert.rejects(()=>worker.processContentGeneration(job),/Selected knowledge/);assert.equal(providerCalls,1);
   await db.query("update knowledge_items set status='approved' where id=$1",[knowledge.id]);
   const countBefore=(await db.query('select count(*)::int as n from content_drafts')).rows[0].n;
   t.mock.method(globalThis,'fetch',async()=>{await db.query("update knowledge_items set status='archived' where id=$1",[knowledge.id]);return generatedResponse();});
   await assert.rejects(()=>worker.processContentGeneration(job),/Selected knowledge changed/);
   assert.equal((await db.query('select count(*)::int as n from content_drafts')).rows[0].n,countBefore);
   const {loadContentKnowledge}=await import('../packages/domain/src/content-knowledge.ts');
   await db.query("update knowledge_items set status='approved' where id=$1",[knowledge.id]);
   assert.ok((await loadContentKnowledge({query},brand)).every(item=>item.id!==knowledge.id));
  });

  await t.test('private product photos enforce limits, sanitize bytes, and attach to selected post knowledge',async()=>{
   const {default:sharp}=await import('sharp');
   const {supabaseAdmin}=await import('../packages/providers/src/supabase.ts');
   let stored=0;
   t.mock.method(supabaseAdmin.storage,'from',()=>({upload:async(_path,bytes,options)=>{assert.equal(options.contentType,'image/jpeg');assert.equal((await sharp(bytes).metadata()).format,'jpeg');stored++;return {error:null};},remove:async()=>({error:null}),download:async()=>({data:new Blob([await sharp({create:{width:24,height:24,channels:3,background:'#204060'}}).jpeg().toBuffer()]),error:null})}));
   const newKnowledge=(await request('POST',`/v1/brands/${brand}/knowledge`,{scope:'chat',type:'product',title:'Photo fixture',content:'A blue product in a box.',source:''})).json().knowledge;
   await request('POST',`/v1/brands/${brand}/knowledge/${newKnowledge.id}/approve`);
   const url=`/v1/brands/${brand}/knowledge/${newKnowledge.id}/photos`;
   const upload=(bytes,mime='image/png',path=url)=>server.inject({method:'POST',url:path,headers:{host:'localhost','content-type':mime},remoteAddress:'127.0.0.1',payload:bytes});
   const firstBytes=await sharp({create:{width:24,height:24,channels:3,background:'#123456'}}).png().toBuffer();
   assert.equal((await upload(Buffer.from('not an image'))).statusCode,400);
   assert.equal((await upload(Buffer.alloc(5*1024*1024+1))).statusCode,413);
   assert.equal((await upload(firstBytes,'image/svg+xml')).statusCode,415);
   assert.equal((await upload(firstBytes,'image/png',`/v1/brands/${stranger}/knowledge/${newKnowledge.id}/photos`)).statusCode,403);
   const first=await upload(firstBytes);assert.equal(first.statusCode,201);const photo=first.json().photo;
   const duplicate=await upload(firstBytes);assert.equal(duplicate.json().photo.id,photo.id);assert.equal(stored,1);
   for(let i=1;i<7;i++){const bytes=await sharp({create:{width:24,height:24,channels:3,background:{r:i*30,g:30,b:80}}}).png().toBuffer();assert.equal((await upload(bytes)).statusCode,201);}
   const eighth=await sharp({create:{width:24,height:24,channels:3,background:'#ff0000'}}).png().toBuffer();
   assert.equal((await upload(eighth)).statusCode,400);assert.equal(stored,7);
   const input={brief:'Introduce the product',platforms:['instagram'],language:'en',generateImages:true,knowledgeIds:[newKnowledge.id],knowledgePhotoId:photo.id,photoMode:'original'};
   assert.equal((await request('POST',`/v1/brands/${brand}/generate`,{...input,knowledgeIds:[knowledge.id]})).statusCode,400);
   const queued=await request('POST',`/v1/brands/${brand}/generate`,input);assert.equal(queued.statusCode,202);
   const job=(await db.query('select * from background_jobs where id=$1',[queued.json().jobId])).rows[0];
   t.mock.method(globalThis,'fetch',async (url,init)=>{assert.match(String(url),/openrouter/);if(JSON.parse(init.body).response_format.json_schema.name==='photo_direction')return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({photoId:photo.id,description:'A blue product in a box with plain packaging.'})}}]}));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({drafts:[{platform:'instagram',caption:'Meet our product.',hashtags:[],visualBrief:'A blue product in a box on a clean background.',sourceFacts:[newKnowledge.id]}]})}}]}));});
   const result=await worker.processContentGeneration(job);assert.equal(result.imageJobIds.length,0);
   assert.equal((await db.query('select asset_id from content_drafts where id=$1',[result.draftIds[0]])).rows[0].asset_id,photo.asset_id);
   const autoResult=await worker.processContentGeneration({...job,payload:{...input,knowledgePhotoId:undefined,photoMode:'auto'}});
   assert.equal(autoResult.imageJobIds.length,1);
   const autoDraft=(await db.query('select * from content_drafts where id=$1',[autoResult.draftIds[0]])).rows[0];
   assert.equal(autoDraft.reference_asset_id,photo.asset_id);
   assert.equal(autoDraft.reference_knowledge_id,newKnowledge.id);
   assert.equal(autoDraft.asset_id,null);
   assert.match(autoDraft.photo_grounding,/blue product/);
   const imageJob=(await db.query('select * from background_jobs where id=$1',[autoResult.imageJobIds[0]])).rows[0];
   t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.match(String(url),/openrouter\.ai\/api\/v1\/images/);
    const request=JSON.parse(String(init.body));
    assert.equal(request.model,'google/gemini-3.1-flash-lite-image');
    assert.match(request.prompt,/blue product/);
    assert.equal(request.input_references.length,1);
    return new Response(JSON.stringify({data:[{b64_json:(await sharp(firstBytes).jpeg().toBuffer()).toString('base64'),media_type:'image/jpeg'}]}),{headers:{'content-type':'application/json'}});
   });
   await worker.processImageGeneration(imageJob);
   const generated=(await db.query('select * from content_drafts where id=$1',[autoDraft.id])).rows[0];
   assert.ok(generated.asset_id);assert.notEqual(generated.asset_id,photo.asset_id);
   assert.equal(generated.reference_asset_id,photo.asset_id);
   await request('DELETE',url+'/'+photo.id);
   await worker.processImageGeneration({...imageJob,payload:{...imageJob.payload,expectedVersion:generated.approval_version}});
   await db.query("update knowledge_items set status='archived' where id=$1",[newKnowledge.id]);
   const current=(await db.query('select approval_version from content_drafts where id=$1',[autoDraft.id])).rows[0];
   await assert.rejects(()=>worker.processImageGeneration({...imageJob,payload:{...imageJob.payload,expectedVersion:current.approval_version}}),/approved knowledge/);
   await db.query("update knowledge_items set status='approved' where id=$1",[newKnowledge.id]);
   assert.equal((await db.query('select count(*)::int n from knowledge_photos where knowledge_id=$1',[newKnowledge.id])).rows[0].n,6);
   assert.equal((await db.query('select count(*)::int n from assets where id=$1',[photo.asset_id])).rows[0].n,1);
   await assert.rejects(()=>worker.processContentGeneration(job),/Choose a product photo/);
   assert.equal((await upload(eighth)).statusCode,201);
   await as('authenticated',owner,()=>assert.rejects(()=>db.query('select * from knowledge_photos'),/permission denied/));
  });
 } finally { await server.close();await database.end(); }
});




