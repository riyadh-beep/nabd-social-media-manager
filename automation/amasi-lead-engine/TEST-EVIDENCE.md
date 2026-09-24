# Live Test Evidence Required

The package is ready for live testing, not client-grade certification. Record the UTC time, workflow version, execution/run ID, input fixture, expected result, observed result, side-effect count and relevant database rows for each test.

- Malformed dashboard command: rejected with no lead, message or handover created.
- Duplicate dashboard or Unipile event: exactly one sequence, message or handover side effect.
- HTTP 429 with `Retry-After`: bounded backoff and no duplicate send.
- Expired credential / 401 / 403: no retry loop, redacted alert, documented reconnect.
- Timeout / 5xx: retry exhaustion creates one dead letter and a redacted alert.
- Invalid Unipile signature: rejected before any conversation or sequence update.
- Malformed AI JSON: safe validation failure, no message sent.
- Unauthorized or failed AI tool/output: contained and dead-lettered where appropriate.
- Missed scheduled heartbeat: one alert that clears after a fresh successful run.
- Ten clean end-to-end runs plus a 100-run staging soak test at twice expected peak volume.
