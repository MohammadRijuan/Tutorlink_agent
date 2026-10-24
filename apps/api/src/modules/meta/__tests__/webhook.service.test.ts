import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.DIRECT_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-012345678901234567890";
process.env.CRON_SECRET ||= "test-cron-secret-012345678901234567890";
process.env.META_APP_SECRET ||= "local-test-app-secret";
process.env.META_VERIFY_TOKEN ||= "local-test-verify-token";

const { verifyMetaSignature, verifyMetaWebhookSubscription } = await import("../webhook-security.js");

test("Meta webhook signature accepts the exact raw body and rejects tampering", () => {
  const raw = Buffer.from('{"object":"page","entry":[]}');
  const signature = `sha256=${createHmac("sha256", process.env.META_APP_SECRET!).update(raw).digest("hex")}`;
  assert.equal(verifyMetaSignature(raw, signature), true);
  assert.equal(verifyMetaSignature(Buffer.from('{"object":"page"}'), signature), false);
  assert.equal(verifyMetaSignature(raw, "sha256=bad"), false);
});

test("Meta webhook verification returns challenge only for the configured verify token", () => {
  assert.equal(verifyMetaWebhookSubscription("subscribe", process.env.META_VERIFY_TOKEN, "abc123"), "abc123");
  assert.equal(verifyMetaWebhookSubscription("subscribe", "wrong", "abc123"), null);
  assert.equal(verifyMetaWebhookSubscription("unsubscribe", process.env.META_VERIFY_TOKEN, "abc123"), null);
});
