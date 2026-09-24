import assert from "node:assert/strict";
import test from "node:test";
import { apiListener, assertHostedOrigins } from "../packages/config/src/hosting.js";

test("local API remains loopback-only; hosted API honors the assigned port", () => {
  assert.deepEqual(apiListener({}), { host: "127.0.0.1", port: 8787 });
  assert.deepEqual(apiListener({ API_PORT: "9000" }), { host: "127.0.0.1", port: 9000 });
  assert.deepEqual(apiListener({ NODE_ENV: "production", PORT: "4321", API_PORT: "9000" }), { host: "0.0.0.0", port: 4321 });
  assert.throws(() => apiListener({ PORT: "65536" }), /PORT or API_PORT/);
});

test("production rejects missing and local origins without echoing their values", () => {
  assert.doesNotThrow(() => assertHostedOrigins({ NODE_ENV: "development" }));
  assert.throws(() => assertHostedOrigins({ NODE_ENV: "production" }), /^Error: APP_ORIGIN must be a public HTTPS origin in production$/);
  for (const invalid of ["http://localhost:3000", "https://localhost", "https://private-user:private-value@example.test", "https://example.test/path"]) {
    assert.throws(() => assertHostedOrigins({ NODE_ENV: "production", APP_ORIGIN: invalid }), /^Error: APP_ORIGIN must be a public HTTPS origin in production$/);
  }
  assert.throws(() => assertHostedOrigins({ NODE_ENV: "production", APP_ORIGIN: "https://web.example.test" }), /API_PUBLIC_URL/);
  assert.doesNotThrow(() => assertHostedOrigins({ NODE_ENV: "production", APP_ORIGIN: "https://web.example.test", API_PUBLIC_URL: "https://api.example.test" }));
});
