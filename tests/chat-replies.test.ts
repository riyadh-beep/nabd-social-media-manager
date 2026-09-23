import test from 'node:test';
import assert from 'node:assert/strict';
import { generateChatReply } from '../packages/providers/src/chat-replies.js';
import { instagramSender } from '../packages/providers/src/unipile.js';
import type { AppEnvironment } from '../packages/config/src/env.js';
const environment={openRouter:{apiKey:'fake-test-key',model:'content-model',chatModel:'z-ai/glm-5.3-flash'}} as AppEnvironment;
const id='11111111-1111-4111-8111-111111111111';
const input={brandName:'Demo',messages:[{sender_type:'customer',body:'When do you close?'}],knowledge:[{id,title:'Hours',content:'We close at 6 PM.'}]};
const valid={text:'We close at 6 PM.',sourceKnowledgeIds:[id],needsHuman:false,reason:''};
test('AI replies use the locked GLM 5.3 Flash model, strict schema, and approved source IDs',async t=>{
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{const request=JSON.parse(String(init?.body));assert.equal(request.model,'z-ai/glm-5.3-flash');assert.equal(request.response_format.type,'json_schema');assert.match(request.messages[0].content,/Never invent/);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}]}));});
 assert.deepEqual((await generateChatReply(environment,input)).sourceKnowledgeIds,[id]);
});
test('uncited answers always require human review',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...valid,sourceKnowledgeIds:[]})}}]})));
 assert.equal((await generateChatReply(environment,{...input,knowledge:[]})).needsHuman,true);
});
test('invented citations and incomplete model output are rejected',async t=>{
 let body=JSON.stringify({...valid,sourceKnowledgeIds:['22222222-2222-4222-8222-222222222222']});
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({choices:[{message:{content:body}}]})));
 await assert.rejects(()=>generateChatReply(environment,input),/unapproved knowledge/);
 body='{"text":"partial"}';await assert.rejects(()=>generateChatReply(environment,input),/validation/);
 body='not json';await assert.rejects(()=>generateChatReply(environment,input),/invalid format/);
});
test('an empty strict response retries once with a JSON-only prompt and remains validated',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
  calls++;const request=JSON.parse(String(init?.body));
  if(calls===1){assert.equal(request.response_format.type,'json_schema');return new Response(JSON.stringify({choices:[{message:{content:''}}]}));}
  assert.equal(request.response_format,undefined);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}]}));
 });
 assert.equal((await generateChatReply(environment,input)).text,valid.text);assert.equal(calls,2);
});
test('provider errors do not reveal response bodies and never use mock replies',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('private-provider-detail',{status:429}));
 await assert.rejects(()=>generateChatReply(environment,input),e=>e instanceof Error&&e.message.includes('429')&&!e.message.includes('private-provider-detail'));
 await assert.rejects(()=>generateChatReply({openRouter:{model:'unused'}} as AppEnvironment,input),/OPENROUTER_API_KEY/);
});
test('Instagram identity prefers public usernames and rejects unrelated profile URLs',()=>{
 assert.deepEqual(instagramSender({sender:{attendee_public_identifier:'demo.shop',attendee_name:'Demo Shop'}}),{username:'demo.shop',name:'Demo Shop'});
 assert.equal(instagramSender({sender:{attendee_profile_url:'https://www.instagram.com/example_user/'}}).username,'example_user');
 assert.equal(instagramSender({sender:{attendee_profile_url:'https://evil.example/user'}}).username,null);
 assert.equal(instagramSender({sender:{username:'<script>'}}).username,null);
});
