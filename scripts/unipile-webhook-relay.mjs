import { createServer, request as upstreamRequest } from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';

// A development tunnel may reach only this callback, never the local owner API.
export function createWebhookRelay(apiPort) {
  return createServer((request, response) => {
    if (request.url !== '/v1/webhooks/unipile' || request.method !== 'POST') {
      response.writeHead(404).end();
      request.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 1024 * 1024) chunks.push(chunk);
      else if (!response.writableEnded) response.writeHead(413).end();
    });
    request.on('end', () => {
      if (response.writableEnded) return;
      const body = Buffer.concat(chunks);
      const headers = { 'content-type': 'application/json', 'content-length': body.length };
      for (const name of ['unipile-auth', 'unipile-signature']) {
        if (typeof request.headers[name] === 'string') headers[name] = request.headers[name];
      }
      const upstream = upstreamRequest({
        hostname: '127.0.0.1', port: apiPort, method: 'POST',
        path: '/v1/webhooks/unipile', headers, timeout: 20000,
      }, (result) => {
        response.writeHead(result.statusCode ?? 502, { 'content-type': 'application/json' });
        result.pipe(response);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      upstream.end(body);
    });
    request.on('error', () => { if (!response.writableEnded) response.destroy(); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  config({ quiet: true });
  const apiPort = Number(process.env.API_PORT ?? 8787);
  const relayPort = Number(process.env.WEBHOOK_RELAY_PORT ?? 8788);
  if (![apiPort, relayPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535)) {
    throw new Error('API_PORT and WEBHOOK_RELAY_PORT must be valid ports');
  }
  const server = createWebhookRelay(apiPort);
  server.requestTimeout = 25000;
  server.headersTimeout = 10000;
  server.listen(relayPort, '127.0.0.1', () => console.log('Unipile-only development relay is listening.'));
}
