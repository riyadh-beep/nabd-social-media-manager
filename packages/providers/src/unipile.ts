import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookVerification = { valid: true } | { valid: false; reason: "missing" | "malformed" | "expired" | "invalid" };

export function verifyUnipileSignature(
  header: string | undefined,
  rawBody: string,
  secret: string | undefined,
  toleranceSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebhookVerification {
  if (!header || !secret) return { valid: false, reason: "missing" };
  const fields = Object.fromEntries(header.split(",").map((part) => part.trim().split("=", 2)));
  const timestamp = Number(fields.t);
  const received = fields.v0;
  if (!Number.isSafeInteger(timestamp) || !received || !/^[a-f0-9]+$/i.test(received)) return { valid: false, reason: "malformed" };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { valid: false, reason: "expired" };
  const expected = createHmac("sha256", secret).update(String(timestamp) + "." + rawBody).digest("hex");
  if (expected.length !== received.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return { valid: false, reason: "invalid" };
  return { valid: true };
}

/**
 * Unipile's DSN/v1 webhook API authenticates callbacks with a caller-defined
 * HTTP header. v2 callbacks continue to use verifyUnipileSignature above.
 */
export function verifyUnipileV1Header(value: string | undefined, secret: string | undefined): WebhookVerification {
  if (!value || !secret) return { valid: false, reason: "missing" };
  const received = Buffer.from(value);
  const expected = Buffer.from(secret);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return { valid: false, reason: "invalid" };
  return { valid: true };
}

export function unipileV1BaseUrl(dsn: string): string {
  const value = dsn.trim().replace(/\/+$/, "");
  return value.startsWith("https://") || value.startsWith("http://") ? value : `https://${value}`;
}

export type UnipileAccount = { id: string; connection_params?: { im?: { username?: string } } };

export function instagramSender(body: Record<string, unknown>): { username: string | null; name: string | null } {
  const sender = body.sender && typeof body.sender === "object" ? body.sender as Record<string, unknown> : {};
  const publicIdentifier = sender.username ?? sender.attendee_public_identifier;
  let username = typeof publicIdentifier === "string" ? publicIdentifier.replace(/^@/, "") : null;
  if (!username && typeof sender.attendee_profile_url === "string") {
    try { const url = new URL(sender.attendee_profile_url); if (["instagram.com","www.instagram.com"].includes(url.hostname)) username = url.pathname.split("/").filter(Boolean)[0] ?? null; } catch { /* Missing or malformed profile URL. */ }
  }
  if (username && !/^[a-zA-Z0-9._]{1,30}$/.test(username)) username = null;
  const name = typeof sender.attendee_name === "string" ? sender.attendee_name.trim().slice(0,150) : null;
  return { username, name: name || null };
}

export async function listUnipileV1Accounts(input: { apiKey?: string; dsn?: string }): Promise<{ accounts: UnipileAccount[] }> {
  if (!input.apiKey || !input.dsn) throw new Error("Unipile is not configured");
  const response = await fetch(`${unipileV1BaseUrl(input.dsn)}/api/v1/accounts`, {
    headers: { "x-api-key": input.apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Unipile account check was rejected (${response.status})`);
  const result = await response.json() as unknown;
  const candidates = Array.isArray(result) ? result : Array.isArray((result as { items?: unknown[] }).items) ? (result as { items: unknown[] }).items : [];
  return { accounts: candidates.filter((account): account is UnipileAccount => Boolean(account && typeof account === "object" && typeof (account as { id?: unknown }).id === "string")) };
}

export async function sendUnipileV1Message(input: { apiKey?: string; dsn?: string; accountId: string; chatId: string; text: string }): Promise<{ id: string }> {
  if (!input.apiKey || !input.dsn) throw new Error("Unipile is not configured");
  const body = new FormData();
  body.set("text", input.text);
  body.set("account_id", input.accountId);
  const response = await fetch(`${unipileV1BaseUrl(input.dsn)}/api/v1/chats/${encodeURIComponent(input.chatId)}/messages`, {
    method: "POST",
    headers: { "x-api-key": input.apiKey, accept: "application/json" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Unipile message delivery was rejected (${response.status})`);
  const result = await response.json() as { id?: unknown; message_id?: unknown };
  const id = typeof result.id === "string" ? result.id : typeof result.message_id === "string" ? result.message_id : undefined;
  if (!id) throw new Error("Unipile did not return a message ID");
  return { id };
}
