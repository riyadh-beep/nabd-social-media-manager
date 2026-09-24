import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import { server } from "../apps/api/src/server.js";
import { drainJobs } from "../apps/worker/src/index.js";

const ready = server.ready();

export const config = { maxDuration: 300 };

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await ready;

  // vercel.json sends /api/health and /api/v1/* here with the original API
  // route in the private `path` query parameter.
  const incoming = new URL(request.url ?? "/api", "https://nabd.invalid");
  const routedPath = incoming.searchParams.get("path");
  incoming.searchParams.delete("path");
  request.url = routedPath
    ? `/${routedPath}${incoming.search}`
    : (incoming.pathname.replace(/^\/api(?=\/|$)/, "") || "/") + incoming.search;

  await new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("close", resolve);
    response.once("error", reject);
    server.server.emit("request", request, response);
  });

  if (request.method !== "OPTIONS" && request.url !== "/health") {
    waitUntil(
      drainJobs({ maxJobs: 12, maxDurationMs: 240_000 }).catch((error) => {
        console.error(
          "Vercel worker drain failed:",
          error instanceof Error ? error.message : "unknown error",
        );
      }),
    );
  }
}
