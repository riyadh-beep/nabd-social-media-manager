import type { IncomingMessage, ServerResponse } from "node:http";
import { drainJobs } from "../../apps/worker/src/index.js";

export const config = { maxDuration: 300 };

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (
    !process.env.CRON_SECRET ||
    request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    response.statusCode = 401;
    response.end("Unauthorized");
    return;
  }

  const result = await drainJobs({ maxJobs: 100, maxDurationMs: 240_000 });
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ ok: true, ...result }));
}
