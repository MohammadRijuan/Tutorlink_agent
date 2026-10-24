import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

export function verifyMetaSignature(rawBody: Buffer, signature: string | undefined) {
  if (!env.META_APP_SECRET || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function verifyMetaWebhookSubscription(mode: string | undefined, token: string | undefined, challenge: string | undefined) {
  return mode === "subscribe" && Boolean(env.META_VERIFY_TOKEN) && token === env.META_VERIFY_TOKEN && Boolean(challenge)
    ? challenge!
    : null;
}
