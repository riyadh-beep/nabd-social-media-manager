import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterImageError, generateOpenRouterImage } from "../packages/providers/src/openrouter-images.js";
import { buildPosterPrompt, posterDirections } from "../packages/providers/src/poster-direction.js";
import { generateDrafts } from "../packages/providers/src/openrouter.js";
import { generateContentSchema } from "../packages/contracts/src/index.js";
import { choosePhotoDirection } from "../packages/providers/src/photo-direction.js";
import { accountState, draftImageState, publishBlocker } from "../app/lib/studio.js";
import type { Account, Draft, Job } from "../app/lib/model.js";

const environment = {
  openRouter: { status: "configured", apiKey: "test-key", model: "test-model", imageModel: "google/gemini-3.1-flash-lite-image" },
} as never;
const sourceId = "00000000-0000-4000-8000-000000000001";
const input = { brief: "Explain our approved guide", platforms: ["instagram", "tiktok", "x"], language: "en", brand: { name: "Test", description: "Test workspace", rules: {} }, knowledge: [{ id: sourceId, title: "Guide", content: "Approved test facts", source: null }] };
const drafts = input.platforms.map(platform => ({ platform, caption: `A ${platform} test caption`, hashtags: ["#test"], visualBrief: "An editorial illustration", sourceFacts: [sourceId] }));

test("every platform receives a different poster prompt, composition and OpenRouter aspect ratio",async context=>{
  const seen:string[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init:RequestInit)=>{
    const request=JSON.parse(String(init.body));
    const key=input.platforms[seen.length] as keyof typeof posterDirections;
    assert.equal(request.model,"google/gemini-3.1-flash-lite-image");
    assert.equal(request.aspect_ratio,key==="instagram"?"4:5":key==="tiktok"?"9:16":"16:9");
    assert.equal(request.input_references.length,1);
    assert.ok(String(request.prompt).length<=2048);
    seen.push(String(request.prompt));
    return new Response(JSON.stringify({data:[{b64_json:Buffer.from([255,216,255]).toString("base64"),media_type:"image/jpeg"}]}),{headers:{"content-type":"application/json"}});
  });
  for(const platform of input.platforms)await generateOpenRouterImage(environment,buildPosterPrompt(platform,"Blue perfume bottle", "Blue bottle with gold cap"),Buffer.from([1]),platform==="instagram"?"4:5":platform==="tiktok"?"9:16":"16:9");
  assert.equal(new Set(seen).size,3);
  assert.match(seen[0], /Unique campaign scene/);
  assert.match(seen[0], /4:5/); assert.match(seen[1], /9:16/); assert.match(seen[2], /16:9/);
});

test("no-photo news posters use the approved subject instead of inventing a reference product",()=>{
 const prompt=buildPosterPrompt("x","An illustration of an AI research paper");
 assert.match(prompt,/AI research paper/);
 assert.doesNotMatch(prompt,/hero product|from the reference/);
});

test("OpenRouter retry classification protects provider response bodies",async context=>{
  let status=503;
  context.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({error:{message:"private provider diagnostic"}}),{status}));
  await assert.rejects(generateOpenRouterImage(environment,"test"),(error:unknown)=>error instanceof OpenRouterImageError&&error.retryable&&!error.message.includes("private provider"));
  status=400;await assert.rejects(generateOpenRouterImage(environment,"test"),(error:unknown)=>error instanceof OpenRouterImageError&&!error.retryable);
});

test("image progress follows a retry and never marks a missing image as ready",()=>{
  const draft={id:sourceId,asset_id:null} as Draft;
  const failed={id:"first",draft_id:sourceId,kind:"image.generate",status:"needs_review",created_at:"2026-09-20T10:00:00Z"} as Job;
  assert.equal(draftImageState(draft,[failed],"first").failed,true);
  assert.equal(draftImageState(draft,[],"first").ready,false);
  const retry={...failed,id:"retry",status:"queued",created_at:"2026-09-20T10:01:00Z"};
  assert.equal(draftImageState(draft,[failed,retry],"first").working,true);
  assert.equal(draftImageState(draft,[failed,retry],"first").failed,false);
  assert.equal(draftImageState({...draft,asset_id:"new"},[failed,{...retry,status:"completed"}],"first").ready,true);
});

test("photo analysis sends image bytes, validates selection and rejects invented references", async context => {
  const photos=[{id:sourceId,knowledgeId:sourceId,title:"Product",dataUrl:"data:image/jpeg;base64,ZmFrZQ=="}];
  let invalid=false;
  context.mock.method(globalThis,"fetch",async(_url: unknown,init: RequestInit)=>{
    const request=JSON.parse(String(init?.body));
    assert.equal(request.model,"openai/gpt-4o-mini");
    assert.equal(request.messages[1].content[2].image_url.url,photos[0].dataUrl);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({photoId:invalid?"00000000-0000-4000-8000-000000000099":sourceId,description:"A blue box with a gold circular label."})}}]}));
  });
  assert.equal((await choosePhotoDirection(environment,"Introduce this product",photos)).photoId,sourceId);
  invalid=true;await assert.rejects(choosePhotoDirection(environment,"Introduce",photos),/could not validate/);
});

test("photo grounding reaches the copywriter and requires the photographed source citation",async context=>{
  context.mock.method(globalThis,"fetch",async(_url: unknown,init: RequestInit)=>{
    const request=JSON.parse(String(init?.body));
    assert.equal(JSON.parse(request.messages[1].content).photoDirection.description,"A blue box with a gold circular label.");
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({drafts})}}]}));
  });
  assert.equal((await generateDrafts(environment,{...input,photoDirection:{knowledgeId:sourceId,description:"A blue box with a gold circular label."}})).length,3);
});

test("OpenRouter Image API image data becomes an actual private-storage image", async (context) => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: [{ b64_json: image.toString("base64"), media_type: "image/jpeg" }] }), { headers: { "content-type": "application/json" } }));
  const result = await generateOpenRouterImage(environment, "Test illustration");
  assert.equal(result.mimeType, "image/jpeg");
  assert.deepEqual([...result.bytes], [...image]);
});

test("OpenRouter failure or non-image content never becomes a successful asset", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: [] }), { headers: { "content-type": "application/json" } }));
  await assert.rejects(generateOpenRouterImage(environment, "Test"), /did not return a generated image/);
});

test("one validated OpenRouter draft is produced for every selected platform", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ drafts }) } }] })));
  const result = await generateDrafts(environment, input);
  assert.deepEqual(result.map(draft => draft.platform), input.platforms);
});

test("common model casing and source-object variations are normalized safely", async (context) => {
  const variant = drafts.map((draft) => ({
    platform: draft.platform,
    Caption: draft.caption,
    visual_brief: draft.visualBrief,
    source_facts: [{ id: sourceId }],
  }));
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify({ drafts: variant })}\n\`\`\`` } }] })));
  const result = await generateDrafts(environment, input);
  assert.deepEqual(result.map(draft => draft.caption), drafts.map(draft => draft.caption));
  assert.deepEqual(result.map(draft => draft.sourceFacts), drafts.map(() => [sourceId]));
  assert.deepEqual(result.map(draft => draft.hashtags), [[], [], []]);
});

test("generation enforces a strict schema and repairs an incomplete batch once", async (context) => {
  const requests: Array<{ response_format: { type: string; json_schema: { strict: boolean; schema: { properties: { drafts: { items: { anyOf: Array<{ properties: { platform: { enum: string[] }; caption: { maxLength: number }; sourceFacts: { items: { enum: string[] } } } }> } } } } } }; provider: { require_parameters: boolean }; messages: Array<{ content: string }> }> = [];
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    const output = requests.length === 1 ? drafts.map(draft => ({ ...draft, visualBrief: undefined })) : drafts;
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ drafts: output }) } }] }));
  });
  assert.deepEqual(await generateDrafts(environment, input), drafts);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, "json_schema");
  assert.equal(requests[0].response_format.json_schema.strict, true);
  const variants = requests[0].response_format.json_schema.schema.properties.drafts.items.anyOf;
  assert.deepEqual(variants[0].properties.sourceFacts.items.enum, [sourceId]);
  assert.equal(variants.find(variant => variant.properties.platform.enum[0] === "x")?.properties.caption.maxLength, 200);
  assert.equal(requests[0].provider.require_parameters, true);
  assert.match(requests[1].messages.at(-1)!.content, /visualBrief/);
});

test("repair is bounded and persistent invalid output never becomes a draft", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }));
  });
  await assert.rejects(generateDrafts(environment, input), /Automatic repair also failed/);
  assert.equal(calls, 2);
});

test("X needs a usable image prompt rather than an empty or N/A placeholder", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    const output = drafts.map(draft => draft.platform === "x" ? { ...draft, visualBrief: calls === 1 ? "" : "N/A" } : draft);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ drafts: output }) } }] }));
  });
  await assert.rejects(generateDrafts(environment, input), /visualBrief.*Automatic repair also failed/);
  assert.equal(calls, 2);
});

test("truncated output is repaired while provider rejection and refusal are not retried", async (context) => {
  let calls = 0;
  let mode = "truncated";
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (mode === "rejected") return new Response("private provider error", { status: 401 });
    return new Response(JSON.stringify({ choices: [{ finish_reason: mode === "truncated" && calls === 1 ? "length" : "stop", message: { content: JSON.stringify({ drafts }), ...(mode === "refused" ? { refusal: "Declined" } : {}) } }] }));
  });
  assert.equal((await generateDrafts(environment, input)).length, 3);
  assert.equal(calls, 2);
  mode = "rejected"; calls = 0;
  await assert.rejects(generateDrafts(environment, input), /status 401/);
  assert.equal(calls, 1);
  mode = "refused"; calls = 0;
  await assert.rejects(generateDrafts(environment, input), /declined/);
  assert.equal(calls, 1);
});

test("partial, duplicate, or invented-source generations cannot look complete", async (context) => {
  let responseDrafts = drafts.slice(0, 2);
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ drafts: responseDrafts }) } }] })));
  await assert.rejects(generateDrafts(environment, input), /one draft per selected platform/);
  responseDrafts = [drafts[0], drafts[0], drafts[2]];
  await assert.rejects(generateDrafts(environment, input), /one draft per selected platform/);
  responseDrafts = drafts.map(draft => ({ ...draft, sourceFacts: ["00000000-0000-4000-8000-000000000002"] }));
  await assert.rejects(generateDrafts(environment, input), /unknown source/);
});

test("X length includes hashtags before the draft can be reviewed", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ drafts: drafts.map(draft => draft.platform === "x" ? { ...draft, caption: "a".repeat(279) } : draft) }) } }] })));
  await assert.rejects(generateDrafts(environment, input), /280 characters/);
});

test("image generation is explicit and enabled in the guided request", () => {
  assert.equal(generateContentSchema.parse({ brief: "Test", platforms: ["x"], language: "en" }).generateImages, false);
  assert.equal(generateContentSchema.parse({ brief: "Test", platforms: ["x"], language: "en", generateImages: true }).generateImages, true);
});

test("share controls distinguish an active account from a ready publishing channel", () => {
  const account = { connection_status: "connected", last_checked_at: new Date().toISOString(), connection_metadata: { buffer_channel_id: "test-channel" } } as Account;
  const draft = { platform: "instagram", status: "draft", asset_id: "test-image" } as Draft;
  assert.equal(accountState(account).active, true);
  assert.equal(publishBlocker(draft, account), null);
  assert.equal(publishBlocker({ ...draft, asset_id: null }, account), "An image is required");
  assert.equal(publishBlocker({ ...draft, platform: "tiktok" }, account), null);
  assert.equal(publishBlocker({ ...draft, platform: "tiktok", asset_id: null }, account), "An image is required");
  assert.equal(publishBlocker(draft, { ...account, connection_metadata: {} }), "Verify Buffer connection");
  assert.equal(accountState({ ...account, last_checked_at: "2020-01-01T00:00:00Z" }).active, false);
  assert.equal(accountState().active, false);
});
