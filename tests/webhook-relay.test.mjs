import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createWebhookRelay } from '../scripts/unipile-webhook-relay.mjs';

test('public relay exposes only the webhook and preserves raw signed content', async () => {
  let calls = 0;
  const upstream = createServer(async (request, response) => {
    calls++;
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.equal(body, '{ "fixture": true }');
    assert.equal(request.headers['unipile-auth'], 'fake-test-secret');
    assert.equal(request.headers.authorization, undefined);
    response.writeHead(200).end('{"received":true}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const relay = createWebhookRelay(upstream.address().port);
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  const base = `http://127.0.0.1:${relay.address().port}`;
  try {
    for (const path of ['/v1/brands', '/health', '/v1/webhooks/unipile']) {
      assert.equal((await fetch(base + path)).status, 404);
    }
    const result = await fetch(base + '/v1/webhooks/unipile', {
      method: 'POST', headers: { 'Unipile-Auth': 'fake-test-secret', Authorization: 'fake-owner-token' },
      body: '{ "fixture": true }',
    });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { received: true });
    assert.equal(calls, 1);
    assert.equal((await fetch(base + '/v1/webhooks/unipile', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
    assert.equal(calls, 1);
  } finally {
    relay.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => relay.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});
