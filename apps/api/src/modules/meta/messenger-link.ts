import { env } from "../../config/env.js";
import { MetaApiError } from "./meta.service.js";

/** Every published caption link carries ?ref=tl_<contentId>, so a Messenger conversation can be attributed to the exact post. */
export const REF_PREFIX = "tl_";
const ALLOWED_HOSTS = ["m.me", "www.m.me", "messenger.com", "www.messenger.com", "www.facebook.com", "facebook.com"];

export function messengerBaseUrl(): URL {
  if (!env.META_MESSENGER_URL) throw new MetaApiError("Set META_MESSENGER_URL to the verified TutorLink Page conversation URL (for example https://m.me/YourPageUsername) before enabling publishing.", 400);
  const url = new URL(env.META_MESSENGER_URL);
  if (url.pathname === "/" || !ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) throw new MetaApiError("META_MESSENGER_URL must point to m.me, Messenger, or the verified Facebook Page.", 400);
  return url;
}

export function messengerUrlFor(contentId: string): string {
  const url = messengerBaseUrl();
  if (url.hostname.toLowerCase().endsWith("m.me")) url.searchParams.set("ref", `${REF_PREFIX}${contentId}`);
  return url.toString();
}

/** Extracts a ContentItem id from a Messenger referral ref, or null when it is not one of ours. */
export function parseContentRef(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith(REF_PREFIX)) return null;
  const id = ref.slice(REF_PREFIX.length);
  return /^[A-Za-z0-9_-]{10,64}$/.test(id) ? id : null;
}
