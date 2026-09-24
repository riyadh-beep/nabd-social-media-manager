import assert from "node:assert/strict";
import test from "node:test";
import { createBufferPost } from "../packages/providers/src/buffer.js";
import { sendUnipileV1Message } from "../packages/providers/src/unipile.js";

const environment = {
  buffer: { status: "configured", apiKey: "test-buffer-key" },
  unipile: { status: "configured", apiKey: "test-unipile-key", dsn: "api.example.test" },
} as never;

test("immediate TikTok photo publishing sets the correct mode and metadata", async (context) => {
  let request: RequestInit | undefined;
  context.mock.method(globalThis,"fetch",async (_url: unknown,init: RequestInit) => {
    request=init;
    return new Response(JSON.stringify({data:{createPost:{__typename:"PostActionSuccess",post:{id:"photo-1",status:"pending"}}}}));
  });
  await createBufferPost({environment,channelId:"test-tiktok",platform:"tiktok",text:"A useful AI tip",mode:"now",imageUrl:"https://assets.example.test/photo.jpg"});
  const input=JSON.parse(String(request?.body)).variables.input;
  assert.equal(input.mode,"shareNow");
  assert.deepEqual(input.metadata,{tiktok:{title:"A useful AI tip"}});
  assert.equal(input.needsApproval,false);
  assert.equal(input.assets.length,1);
});

test("an expired schedule is rejected before any provider submission", async (context) => {
  let calls=0;
  context.mock.method(globalThis,"fetch",async () => {calls++;return new Response("{}");});
  await assert.rejects(createBufferPost({environment,channelId:"test",text:"Test",dueAt:"2000-01-01T00:00:00Z"}),/future/);
  assert.equal(calls,0);
});

test("a confirmed Buffer validation rejection is distinct from an unknown network outcome", async (context) => {
  context.mock.method(globalThis,"fetch",async () => new Response(JSON.stringify({data:{createPost:{__typename:"InvalidInputError",message:"Image is required"}}})));
  await assert.rejects(createBufferPost({environment,channelId:"test",text:"Test"}),error=>error instanceof Error && error.name==="Error" && error.constructor.name==="BufferPostRejected");
});

test("Buffer publishing submits a scheduled image post and returns only the provider reference", async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = (async (_url, init) => {
    request = init;
    return new Response(JSON.stringify({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "post-1", status: "scheduled", dueAt: "2026-09-21T10:00:00.000Z" } } } }), { status: 200 });
  }) as typeof fetch;
  try {
    const post = await createBufferPost({ environment, channelId: "channel-1", platform: "instagram", text: "Approved post", dueAt: new Date(Date.now()+86400_000).toISOString(), imageUrl: "https://assets.example.test/image.png" });
    const payload = JSON.parse(String(request?.body));
    assert.equal(post.id, "post-1");
    assert.equal(payload.variables.input.mode, "customScheduled");
    assert.deepEqual(payload.variables.input.metadata, { instagram: { type: "post", shouldShareToFeed: true, isAiGenerated: true } });
    assert.deepEqual(payload.variables.input.assets, [{ image: { url: "https://assets.example.test/image.png" } }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("Unipile replies use the configured DSN, account, and existing conversation", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  let body: FormData | undefined;
  globalThis.fetch = (async (input, init) => {
    url = String(input);
    body = init?.body as FormData;
    return new Response(JSON.stringify({ id: "message-1" }), { status: 200 });
  }) as typeof fetch;
  try {
    const sent = await sendUnipileV1Message({ apiKey: "test-unipile-key", dsn: "api.example.test", accountId: "account-1", chatId: "chat-1", text: "Thank you" });
    assert.equal(sent.id, "message-1");
    assert.match(url, /api\.example\.test\/api\/v1\/chats\/chat-1\/messages$/);
    assert.equal(body?.get("account_id"), "account-1");
    assert.equal(body?.get("text"), "Thank you");
  } finally { globalThis.fetch = originalFetch; }
});
