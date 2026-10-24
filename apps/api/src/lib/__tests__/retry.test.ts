import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, classifyProviderFailure, OperationError, retryAfterMs, withFallback, withRetry } from "../retry.js";

test("a successful first attempt does not sleep or retry", async () => {
  let calls = 0;
  const value = await withRetry(async () => { calls++; return "ok"; }, { maxAttempts: 3 });
  assert.equal(value, "ok");
  assert.equal(calls, 1);
});

test("a temporary 503 is retried and can recover", async () => {
  let calls = 0;
  const value = await withRetry(async () => {
    calls++;
    if (calls === 1) throw classifyProviderFailure(503, "busy");
    return "recovered";
  }, { maxAttempts: 3, random: () => 0, sleep: async () => {} });
  assert.equal(value, "recovered");
  assert.equal(calls, 2);
});

test("repeated temporary failures stop at the configured attempt count", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw classifyProviderFailure(503, "busy"); }, { maxAttempts: 3, random: () => 0, sleep: async () => {} }),
    (error: unknown) => error instanceof OperationError && error.category === "PROVIDER_UNAVAILABLE",
  );
  assert.equal(calls, 3);
});

test("429 honors Retry-After and parses provider retry durations", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls === 1) throw classifyProviderFailure(429, "rate limited", retryAfterMs("2"));
    return true;
  }, { maxAttempts: 2, sleep: async ms => { delays.push(ms); } });
  assert.equal(result, true);
  assert.deepEqual(delays, [2000]);
  assert.equal(retryAfterMs("1.5s"), 1500);
});

test("network timeouts are transient but authentication errors are not", async () => {
  const timeout = new DOMException("timed out", "TimeoutError");
  await assert.rejects(withRetry(async () => { throw timeout; }, { maxAttempts: 1 }), (error: unknown) => error instanceof OperationError && error.category === "TIMEOUT");
  let authAttempts = 0;
  await assert.rejects(withRetry(async () => { authAttempts++; throw classifyProviderFailure(401, "invalid key"); }, { maxAttempts: 4 }), (error: unknown) => error instanceof OperationError && error.category === "AUTHENTICATION");
  assert.equal(authAttempts, 1);
});

test("connection failures are transient while missing models and permissions are blockers", () => {
  assert.equal(classifyFailure(new TypeError("fetch failed")).category, "NETWORK_ERROR");
  assert.equal(classifyProviderFailure(404, "model not found").retryable, false);
  assert.equal(classifyProviderFailure(403, "permission denied").category, "PERMISSION_DENIED");
});

test("fallback runs only for a retryable primary failure", async () => {
  const value = await withFallback(
    async () => { throw classifyProviderFailure(503, "busy"); },
    async () => "fallback",
  );
  assert.equal(value, "fallback");
  await assert.rejects(
    withFallback(async () => { throw classifyProviderFailure(401, "invalid key"); }, async () => "should not run"),
    (error: unknown) => error instanceof OperationError && error.category === "AUTHENTICATION",
  );
});

test("fallback failures remain explicit", async () => {
  await assert.rejects(
    withFallback(
      async () => { throw classifyProviderFailure(503, "busy"); },
      async () => { throw classifyProviderFailure(404, "missing model"); },
    ),
    (error: unknown) => error instanceof OperationError && error.category === "CONFIGURATION",
  );
});

test("quota exhaustion is classified as a human-action blocker", () => {
  const failure = classifyProviderFailure(429, "daily quota exceeded");
  assert.equal(failure.retryable, false);
  assert.equal(failure.category, "QUOTA_EXHAUSTED");
});
