import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { unipileV1BaseUrl, verifyUnipileSignature, verifyUnipileV1Header } from "../packages/providers/src/unipile.js";
import { webhookEventSchema } from "../packages/contracts/src/index.js";

test("Unipile webhook verification accepts only a current raw-body signature", () => {
  const body = '{"id":"fixture-event"}';
  const secret = "test-webhook-secret";
  const timestamp = 1_700_000_000;
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  assert.deepEqual(verifyUnipileSignature(`t=${timestamp},v0=${signature}`, body, secret, 300, timestamp + 20), { valid: true });
  assert.equal(verifyUnipileSignature(`t=${timestamp},v0=${signature}`, body + " ", secret, 300, timestamp + 20).valid, false);
  assert.deepEqual(verifyUnipileSignature(`t=${timestamp},v0=${signature}`, body, secret, 300, timestamp + 301), { valid: false, reason: "expired" });
});

test("Unipile v1 endpoint is derived only from the configured DSN", () => {
  assert.equal(unipileV1BaseUrl("api32.unipile.example:16204"), "https://api32.unipile.example:16204");
  assert.equal(unipileV1BaseUrl("https://api32.unipile.example:16204/"), "https://api32.unipile.example:16204");
});

test("Unipile v1 webhook header uses a constant-time shared-secret comparison", () => {
  assert.deepEqual(verifyUnipileV1Header("fixture-secret", "fixture-secret"), { valid: true });
  assert.deepEqual(verifyUnipileV1Header("wrong-secret", "fixture-secret"), { valid: false, reason: "invalid" });
  assert.deepEqual(verifyUnipileV1Header(undefined, "fixture-secret"), { valid: false, reason: "missing" });
});

test("Unipile v1 Messaging payloads normalize to durable event identities", () => {
  const event = webhookEventSchema.parse({ account_id: "account-1", event: "message_received", timestamp: "2026-09-19T16:00:00.000Z", message_id: "message-1", message: "hello" });
  assert.equal(event.accountId, "account-1");
  assert.equal(event.eventId, "message-1");
  assert.equal(event.eventType, "message_received");
});
