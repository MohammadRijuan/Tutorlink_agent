import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { ensureRequiredBranding, REQUIRED_HASHTAG } from "../content/safety.rules.js";
import { chooseDesign, createBrandedAsset } from "../content/asset.service.js";
import { publicBaseUrl } from "../share.routes.js";
import { dataUrlToBuffer, svgToPng } from "../content/render.service.js";
import { AUTONOMOUS_ACTORS, autoPause, automationActive, getAutomationState } from "../agent-control.service.js";
import { MetaApiError, sanitizeMetaErrorMessage } from "./meta.service.js";
import { messengerBaseUrl, messengerUrlFor } from "./messenger-link.js";
import { runPublishChecks } from "./publish-checks.js";
import { loadBrand } from "../video/brand.js";
import { renderReelVideo } from "../video/reel-studio.js";
import type { ReelPlan } from "../video/reel-plan.js";

class ReelRenderError extends Error {
  constructor(message: string) { super(message); this.name = "ReelRenderError"; }
}
/** Meta may or may not have published: never retried, never silently marked as success, and automation is paused for a human check. */
export class AmbiguousPublishError extends MetaApiError {
  constructor(message: string) { super(message, 502); this.name = "AmbiguousPublishError"; }
}

type PublishableContent = {
  id: string; title: string; format: string; topic: string; caption: string; hashtags: unknown;
  script: string | null; reelScenes: unknown; assetUrl: string | null; visualStyle: string | null; status: string; platformPostId: string | null;
  creativeAngle: string | null; subtitle: string | null; designPalette: string | null; linkAssetUrl: string | null;
  reelPlan: unknown; voiceAudio: Uint8Array | null; voiceSeconds: number | null; voicePauses: unknown;
};

const HASHTAG_LINE = /^\s*(?:#[\p{L}\p{M}\p{N}_]+\s*)+$/u;

/** Puts the required hashtag first, then the agent's extra hashtags, on one final line. */
export function withHashtags(text: string, hashtags: unknown): string {
  const extra = Array.isArray(hashtags) ? hashtags.filter((tag): tag is string => typeof tag === "string" && /^#[\p{L}\p{M}\p{N}_]+$/u.test(tag) && tag !== REQUIRED_HASHTAG) : [];
  const lines = text.trimEnd().split("\n");
  while (lines.length > 0 && HASHTAG_LINE.test(lines[lines.length - 1]!)) lines.pop();
  return `${lines.join("\n").trimEnd()}\n\n${[REQUIRED_HASHTAG, ...extra].slice(0, 6).join(" ")}`;
}

/**
 * The exact text posted. Link-card posts carry the native Send Message button instead of a raw link in the text;
 * photo and Reel posts keep a clickable Messenger link.
 */
export function buildFinalCaption(caption: string, contentId: string, options: { hashtags?: unknown; includeLink?: boolean } = {}) {
  const body = withHashtags(ensureRequiredBranding(caption), options.hashtags);
  return options.includeLink === false ? body : `${body}\n\n💬 সরাসরি মেসেঞ্জারে কথা বলুন: ${messengerUrlFor(contentId)}`;
}

/**
 * Renders the stored Reel plan with its stored voice-over (nothing is spoken twice, so publishing costs no extra voice quota).
 * Used for publishing and for the dashboard preview.
 */
export async function renderStoredReel(content: { reelPlan: unknown; voiceAudio: Uint8Array | null; voiceSeconds: number | null; voicePauses: unknown; designPalette: string | null; id?: string }, options: { width?: number } = {}) {
  const plan = content.reelPlan as ReelPlan | null;
  if (!plan || !Array.isArray(plan.scenes) || plan.scenes.length < 3) throw new ReelRenderError("This Reel has no scene plan, so it cannot be rendered.");
  if (!content.voiceAudio || !content.voiceSeconds) throw new ReelRenderError("This Reel has no voice-over, so it cannot be rendered (a Reel is never published silent).");
  try {
    const brand = await loadBrand();
    const pauses = Array.isArray(content.voicePauses) ? (content.voicePauses as unknown[]).filter((value): value is number => typeof value === "number") : [];
    const result = await renderReelVideo({ plan, voice: { m4a: Buffer.from(content.voiceAudio), seconds: content.voiceSeconds, pauses }, brand, palette: content.designPalette || "OCEAN", seed: content.id ? content.id.length + content.id.charCodeAt(content.id.length - 1) : 7, width: options.width });
    return { bytes: result.bytes, seconds: result.seconds, frames: result.scenes };
  } catch (error) {
    if (error instanceof ReelRenderError) throw error;
    throw new ReelRenderError(`Reel rendering failed before upload: ${error instanceof Error ? error.message.slice(0, 240) : "unknown renderer error"}`);
  }
}

type GraphPayload = { id?: string; post_id?: string; video_id?: string; upload_url?: string; success?: boolean; error?: { message?: string; code?: number; error_subcode?: number } };

function metaFailure(operation: string, status: number, error: GraphPayload["error"]): MetaApiError {
  console.error(JSON.stringify({ event: "meta_publish_failed", operation, httpStatus: status, code: error?.code ?? null, subcode: error?.error_subcode ?? null, message: sanitizeMetaErrorMessage(error?.message || "", env.META_PAGE_ACCESS_TOKEN) }));
  const denied = error?.code === 190 || error?.code === 10 || error?.code === 200 || error?.code === 368 || status === 401 || status === 403;
  if (denied) return new MetaApiError("Meta denied publishing. Refresh the Page token or verify the required publishing permissions.", 403);
  return new MetaApiError("Meta rejected the publishing request. Check Page permissions, media format, and API error logs.", status >= 500 ? status : 400);
}

async function graphPost(path: string, fields: Record<string, string>, timeoutMs = 20_000): Promise<GraphPayload> {
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`);
  const form = new URLSearchParams({ ...fields, access_token: env.META_PAGE_ACCESS_TOKEN });
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json().catch(() => ({})) as GraphPayload;
  if (!response.ok || payload.error) throw metaFailure(path.split("/").pop() || path, response.status, payload.error);
  return payload;
}

type PublishResult = { postId: string; mediaId: string | null; mediaType: string; processing: string | null; ctaButton?: boolean | null };

/**
 * Link-card post with Meta's native "Send Message" call-to-action button.
 * Only a clean rejection by Meta (nothing was created) falls back to a photo post; an unclear outcome is treated as ambiguous.
 */
async function tryLinkCtaPost(content: PublishableContent): Promise<{ result: PublishResult } | { reason: string }> {
  if (env.META_POST_STYLE === "photo") return { reason: "disabled-by-setting" };
  const base = publicBaseUrl();
  if (!base) return { reason: "no-public-api-url" };
  if (!content.linkAssetUrl) return { reason: "no-link-image" };
  const shareUrl = `${base}/s/${content.id}`;
  try {
    const probe = await fetch(`${shareUrl}/image.png`, { signal: AbortSignal.timeout(20_000) });
    if (!probe.ok || !(probe.headers.get("content-type") || "").includes("image/png")) return { reason: `share-image-http-${probe.status}` };
  } catch { return { reason: "share-image-unreachable" }; }

  const message = buildFinalCaption(content.caption, content.id, { hashtags: content.hashtags, includeLink: false });
  const targets = [...new Set([messengerUrlFor(content.id), messengerBaseUrl().toString()])];
  let lastReason = "meta-rejected-call-to-action";
  for (const target of targets) {
    let response: Response;
    try {
      response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PAGE_ID}/feed`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message, link: shareUrl, published: "true", call_to_action: JSON.stringify({ type: "MESSAGE_PAGE", value: { link: target } }), access_token: env.META_PAGE_ACCESS_TOKEN }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch { throw new AmbiguousPublishError("The link post did not return a response. It may or may not be live; check the Facebook Page before resuming automation."); }
    const payload = await response.json().catch(() => ({})) as GraphPayload;
    if (response.ok && !payload.error && payload.id) {
      let ctaButton: boolean | null = null;
      try {
        const check = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${payload.id}?fields=call_to_action&access_token=${encodeURIComponent(env.META_PAGE_ACCESS_TOKEN)}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
        const info = await check.json().catch(() => ({})) as { call_to_action?: unknown; error?: unknown };
        ctaButton = check.ok && !info.error ? Boolean(info.call_to_action) : null;
      } catch { /* informational only */ }
      return { result: { postId: payload.id, mediaId: null, mediaType: "LINK_CTA", processing: null, ctaButton } };
    }
    if (response.status >= 500) throw new AmbiguousPublishError("Meta returned a server error while publishing the link post. It may or may not be live; check the Facebook Page before resuming automation.");
    const code = payload.error?.code;
    // Only an invalid/expired token is a hard stop here; other rejections (including unsupported call_to_action) fall back to a photo post, which then reports any real permission problem itself.
    if (code === 190 || code === 368 || response.status === 401) throw metaFailure("feed", response.status, payload.error);
    console.error(JSON.stringify({ event: "meta_link_cta_rejected", httpStatus: response.status, code: code ?? null, subcode: payload.error?.error_subcode ?? null, message: sanitizeMetaErrorMessage(payload.error?.message || "", env.META_PAGE_ACCESS_TOKEN) }));
    lastReason = `meta-${code ?? response.status}`;
  }
  return { reason: lastReason };
}

async function publishPhoto(content: PublishableContent, caption: string) {
  const source = content.assetUrl ? dataUrlToBuffer(content.assetUrl) : null;
  if (!source) throw new MetaApiError("A branded banner is required before publishing a feed post.", 400);
  const png = await svgToPng(source);
  const form = new FormData();
  form.set("caption", caption);
  form.set("published", "true");
  form.set("access_token", env.META_PAGE_ACCESS_TOKEN);
  form.set("source", new Blob([new Uint8Array(png)], { type: "image/png" }), `${content.id}.png`);
  let response: Response;
  try { response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PAGE_ID}/photos`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) }); }
  catch { throw new AmbiguousPublishError("The photo upload did not return a response. It may or may not be live; check the Facebook Page before resuming automation."); }
  const payload = await response.json().catch(() => ({})) as GraphPayload;
  if (!response.ok || payload.error || !(payload.post_id || payload.id)) {
    if (response.status >= 500) throw new AmbiguousPublishError("Meta returned a server error while publishing the photo. It may or may not be live; check the Facebook Page before resuming automation.");
    throw metaFailure("photos", response.status, payload.error);
  }
  return { postId: payload.post_id || payload.id!, mediaId: payload.id || null, mediaType: "PHOTO", processing: null as string | null } as PublishResult;
}

async function reelStatus(videoId: string): Promise<{ state: "ready" | "processing" | "error"; detail: string | null }> {
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${videoId}`);
  url.searchParams.set("fields", "status");
  url.searchParams.set("access_token", env.META_PAGE_ACCESS_TOKEN);
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { status?: { video_status?: string; processing_phase?: { status?: string; errors?: Array<{ message?: string }> }; publishing_phase?: { status?: string } }; error?: unknown };
  if (!response.ok || payload.error) return { state: "processing", detail: "status-unavailable" };
  const status = payload.status;
  const video = (status?.video_status || "").toLowerCase();
  if (video === "error" || status?.processing_phase?.status === "error") return { state: "error", detail: status?.processing_phase?.errors?.[0]?.message?.slice(0, 200) || "Meta reported a processing error" };
  if (video === "ready" || status?.publishing_phase?.status === "complete") return { state: "ready", detail: null };
  return { state: "processing", detail: video || null };
}

async function publishReel(content: PublishableContent, caption: string) {
  const rendered = await renderStoredReel(content);
  const started = await graphPost(`${env.META_PAGE_ID}/video_reels`, { upload_phase: "start" });
  if (!started.video_id || !started.upload_url) throw new MetaApiError("Meta did not return a Reel upload session.", 502);
  let uploaded: Response;
  try {
    uploaded = await fetch(started.upload_url, {
      method: "POST",
      headers: { Authorization: `OAuth ${env.META_PAGE_ACCESS_TOKEN}`, offset: "0", file_size: String(rendered.bytes.length), "content-type": "application/octet-stream" },
      body: new Uint8Array(rendered.bytes), signal: AbortSignal.timeout(60_000),
    });
  } catch { throw new MetaApiError("The Reel video upload did not complete. Nothing was published.", 502); }
  const uploadPayload = await uploaded.json().catch(() => ({})) as { success?: boolean; error?: { message?: string; code?: number } };
  if (!uploaded.ok || uploadPayload.error || uploadPayload.success === false) throw new MetaApiError("Meta rejected the Reel video upload. Check video format, file size, and Page permissions.", uploaded.status >= 500 ? uploaded.status : 400);

  let finished: GraphPayload;
  try {
    finished = await graphPost(`${env.META_PAGE_ID}/video_reels`, { upload_phase: "finish", video_id: started.video_id, video_state: "PUBLISHED", title: content.title.slice(0, 100), description: caption });
  } catch (error) {
    // A transport failure or 5xx at "finish" means Meta may have published the Reel: never treat it as a clean failure.
    if (!(error instanceof MetaApiError) || error.status >= 500) throw new AmbiguousPublishError("The Reel finish request did not return a clear answer. It may or may not be live; check the Facebook Page before resuming automation.");
    throw error;
  }

  // Meta processes Reels asynchronously: poll briefly so an outright processing failure is reported instead of assumed success.
  let processing: string | null = null;
  const deadline = Date.now() + 24_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const status = await reelStatus(started.video_id).catch(() => ({ state: "processing" as const, detail: "status-unavailable" }));
    processing = status.detail;
    if (status.state === "ready") { processing = "ready"; break; }
    if (status.state === "error") throw new MetaApiError(`Meta reported that the Reel failed processing${status.detail ? `: ${status.detail}` : ""}.`, 502);
  }
  return { postId: finished.post_id || finished.id || started.video_id, mediaId: started.video_id, mediaType: "REEL", processing: processing ?? "processing" };
}

export async function publishContentItem(contentId: string, actor = "autonomous-agent") {
  if (env.META_PUBLISH_MODE !== "live") throw new MetaApiError("Publishing is in dry-run mode. Set META_PUBLISH_MODE=live only after verifying Page permissions and the Messenger URL.", 400);
  if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) throw new MetaApiError("Configure META_PAGE_ID and META_PAGE_ACCESS_TOKEN before publishing.", 400);
  const autonomous = AUTONOMOUS_ACTORS.includes(actor);
  const content = await prisma.contentItem.findUnique({ where: { id: contentId } }) as PublishableContent | null;
  if (!content) throw new MetaApiError("Content item was not found.", 404);
  if (content.status === "PUBLISHED" || content.platformPostId) return { published: true, duplicate: true, postId: content.platformPostId };
  if (!["DRAFT", "VALIDATED", "SCHEDULED"].includes(content.status)) throw new MetaApiError(`Content in status ${content.status} cannot be published.`, 409);

  // Defence in depth: autonomous publishing re-reads Agent Mode right before touching Meta, so a human switching it OFF mid-run wins.
  if (autonomous && !automationActive(await getAutomationState())) throw new MetaApiError("Agent Mode is off or automation is paused; the draft was kept and nothing was published.", 409);

  const readiness = await runPublishChecks(content);
  if (!readiness.ok) throw new MetaApiError(`Pre-publish validation failed: ${readiness.checks.filter(check => !check.ok).map(check => check.label).join("; ")}.`, 400);

  const claimed = await prisma.contentItem.updateMany({ where: { id: content.id, status: { in: ["DRAFT", "VALIDATED", "SCHEDULED"] }, platformPostId: null }, data: { status: "PUBLISHING", scheduledAt: new Date() } });
  if (claimed.count !== 1) {
    const current = await prisma.contentItem.findUnique({ where: { id: content.id }, select: { status: true, platformPostId: true } });
    if (current?.platformPostId) return { published: true, duplicate: true, postId: current.platformPostId };
    throw new MetaApiError("Another worker already claimed this content. It was not published twice.", 409);
  }
  try {
    const caption = buildFinalCaption(content.caption, content.id, { hashtags: content.hashtags });
    let effectiveFormat = content.format;
    let fallbackFrom: string | null = null;
    let ctaFallback: string | null = null;
    let result: PublishResult;
    if (content.format === "REEL") {
      try {
        result = await publishReel(content, caption);
      } catch (error) {
        // Only fall back when rendering failed before any Meta upload began. Never fall back after an ambiguous Meta response.
        if (!(error instanceof ReelRenderError)) throw error;
        const snapshot = await prisma.pageSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { pageName: true, profilePicture: true } });
        const design = chooseDesign(`${content.title}:${content.id}`, [{ visualStyle: content.visualStyle, designPalette: content.designPalette }]);
        const fallbackStyle = design.style;
        const common = { title: content.title, subtitle: content.subtitle, pageName: snapshot?.pageName || "TutorLink Tuition Media", profilePicture: snapshot?.profilePicture || null, visualStyle: design.style, palette: design.palette };
        const squareAsset = await createBrandedAsset({ ...common, format: "POST" });
        const wideAsset = await createBrandedAsset({ ...common, format: "LINK" });
        const fallback: PublishableContent = { ...content, format: "POST", assetUrl: squareAsset, linkAssetUrl: wideAsset, script: null, visualStyle: fallbackStyle, designPalette: design.palette };
        const fallbackChecks = await runPublishChecks(fallback);
        if (!fallbackChecks.ok) throw new MetaApiError("The Reel could not be rendered and the photo fallback failed validation. Nothing was published.", 400);
        await prisma.contentItem.update({ where: { id: content.id }, data: { format: "POST", assetUrl: squareAsset, linkAssetUrl: wideAsset, script: null, visualStyle: fallbackStyle, designPalette: design.palette } });
        effectiveFormat = "POST";
        fallbackFrom = "REEL_RENDER_FAILED";
        result = await publishPhoto(fallback, caption);
      }
    } else {
      const linked = await tryLinkCtaPost(content);
      if ("result" in linked) result = linked.result;
      else { ctaFallback = linked.reason; result = await publishPhoto(content, caption); }
    }
    const updated = await prisma.contentItem.update({ where: { id: content.id }, data: { status: "PUBLISHED", format: effectiveFormat, platformPostId: result.postId, publishedAt: new Date(), scheduledAt: null } });
    const variables: Array<[string, string | null]> = [["format", effectiveFormat], ["creativeAngle", content.creativeAngle], ["visualStyle", content.visualStyle]];
    await prisma.experiment.createMany({ data: variables.filter((pair): pair is [string, string] => Boolean(pair[1])).map(([experimentKey, variant]) => ({ contentItemId: content.id, experimentKey, variant })) }).catch(() => undefined);
    await prisma.auditEvent.create({ data: { actor, action: "FACEBOOK_CONTENT_PUBLISHED", entityType: "ContentItem", entityId: content.id, details: { postId: result.postId, mediaId: result.mediaId, mediaType: result.mediaType, processing: result.processing, fallbackFrom, ctaButton: result.ctaButton ?? null, ctaFallback, publishedAt: updated.publishedAt } as never } });
    return { published: true, duplicate: false, contentId: content.id, postId: result.postId, mediaId: result.mediaId, mediaType: result.mediaType, format: effectiveFormat, fallbackFrom, ctaButton: result.ctaButton ?? null, ctaFallback, publishedAt: updated.publishedAt };
  } catch (error) {
    const ambiguous = error instanceof AmbiguousPublishError;
    await prisma.contentItem.updateMany({ where: { id: content.id, status: "PUBLISHING", platformPostId: null }, data: { status: "FAILED", scheduledAt: null } }).catch(() => undefined);
    await prisma.auditEvent.create({ data: { actor, action: "FACEBOOK_CONTENT_PUBLISH_FAILED", entityType: "ContentItem", entityId: content.id, details: { error: error instanceof Error ? error.message.slice(0, 400) : "Unknown publishing failure", ambiguous, automaticRetry: false, note: "No automatic retry, to avoid duplicate public posts." } as never } }).catch(() => undefined);
    if (ambiguous) await autoPause("A publish outcome was uncertain. Check the Facebook Page for a duplicate or missing post, then resume Agent Mode manually.").catch(() => undefined);
    else if (error instanceof MetaApiError && error.status === 403) await autoPause("Meta denied publishing (expired or revoked token/permissions). Fix the Page token, then resume Agent Mode.").catch(() => undefined);
    else if (autonomous) {
      const since = new Date(Date.now() - 48 * 3600_000);
      const failures = await prisma.auditEvent.count({ where: { action: "FACEBOOK_CONTENT_PUBLISH_FAILED", actor: { in: AUTONOMOUS_ACTORS }, createdAt: { gte: since } } }).catch(() => 0);
      if (failures >= 3) await autoPause("Three autonomous publishing attempts failed in 48 hours. Review the audit log before resuming.").catch(() => undefined);
    }
    throw error;
  }
}

export async function publishDueScheduledContent() {
  const due = await prisma.contentItem.findFirst({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() }, platformPostId: null }, orderBy: { scheduledAt: "asc" } });
  if (!due) return { published: false, reason: "no-due-scheduled-content" };
  return publishContentItem(due.id, "scheduled-publisher");
}

export async function publishGeneratedContent(contentId: string) {
  return publishContentItem(contentId, "autonomous-agent");
}
