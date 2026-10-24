import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { ffmpegBinary } from "../../lib/ffmpeg.js";
import { ensureRequiredBranding } from "../content/safety.rules.js";
import { createBrandedAsset, resolveVisualStyle } from "../content/asset.service.js";
import { dataUrlToBuffer, svgToPng } from "../content/render.service.js";
import { AUTONOMOUS_ACTORS, autoPause, automationActive, getAutomationState } from "../agent-control.service.js";
import { MetaApiError, sanitizeMetaErrorMessage } from "./meta.service.js";
import { messengerUrlFor } from "./messenger-link.js";
import { runPublishChecks } from "./publish-checks.js";
import { reelFrameSvg, resolveReelFrameTexts } from "./reel-frames.js";

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
  creativeAngle: string | null;
};

export function buildFinalCaption(caption: string, contentId: string) {
  return `${ensureRequiredBranding(caption)}\n\n💬 সরাসরি মেসেঞ্জারে কথা বলুন: ${messengerUrlFor(contentId)}`;
}

const SCENE_SECONDS = 3.4;
const END_CARD_SECONDS = 4.6;
const FADE_SECONDS = 0.35;

function runFfmpeg(binary: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-5000); });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(new ReelRenderError(`Reel rendering could not start: ${error.message.slice(0, 180)}. Check the FFmpeg binary is bundled with the API deployment.`)); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new ReelRenderError(`Reel rendering failed (FFmpeg exit ${code}). ${stderr.slice(-400)}`));
    });
  });
}

/** Renders a real 1080x1920 H.264 + AAC MP4 (hook, scenes, contact end card) with soft fades between scenes. */
export async function renderReel(content: Pick<PublishableContent, "title" | "script" | "reelScenes">) {
  const dir = await mkdtemp(join(tmpdir(), "tutorlink-reel-"));
  try {
    const texts = resolveReelFrameTexts(content);
    const frames: string[] = [];
    const durations: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      const framePath = join(dir, `frame-${i}.png`);
      await writeFile(framePath, await svgToPng(await reelFrameSvg(texts[i]!, i, texts.length)));
      frames.push(framePath);
      durations.push(i === texts.length - 1 ? END_CARD_SECONDS : SCENE_SECONDS);
    }
    const total = durations.reduce((sum, value) => sum + value, 0);
    const videoPath = join(dir, "reel.mp4");
    const args: string[] = ["-hide_banner", "-loglevel", "error", "-y"];
    frames.forEach((frame, i) => args.push("-loop", "1", "-framerate", "25", "-t", String(durations[i]), "-i", frame));
    // Silent stereo AAC track: Reels uploads are safest with an audio stream present.
    args.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
    const filters = frames.map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=25,format=yuv420p,fade=t=in:st=0:d=${FADE_SECONDS},fade=t=out:st=${(durations[i]! - FADE_SECONDS).toFixed(2)}:d=${FADE_SECONDS}[v${i}]`).join(";");
    const concatInputs = frames.map((_, i) => `[v${i}]`).join("");
    args.push("-filter_complex", `${filters};${concatInputs}concat=n=${frames.length}:v=1:a=0[outv]`, "-map", "[outv]", "-map", `${frames.length}:a`,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-t", total.toFixed(2), videoPath);
    await runFfmpeg(ffmpegBinary(), args);
    const bytes = await readFile(videoPath);
    if (bytes.length < 50_000 || bytes.length > 100 * 1024 * 1024) throw new ReelRenderError("Rendered Reel MP4 is unexpectedly small or exceeds the 100 MB upload safety limit.");
    return { bytes, seconds: total, frames: frames.length };
  } catch (error) {
    if (error instanceof ReelRenderError) throw error;
    throw new ReelRenderError(`Reel rendering failed before upload: ${error instanceof Error ? error.message.slice(0, 220) : "unknown renderer error"}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
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
  return { postId: payload.post_id || payload.id!, mediaId: payload.id || null, mediaType: "PHOTO", processing: null as string | null };
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
  const rendered = await renderReel(content);
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
    const caption = buildFinalCaption(content.caption, content.id);
    let effectiveFormat = content.format;
    let fallbackFrom: string | null = null;
    let result: { postId: string; mediaId: string | null; mediaType: string; processing: string | null };
    if (content.format === "REEL") {
      try {
        result = await publishReel(content, caption);
      } catch (error) {
        // Only fall back when rendering failed before any Meta upload began. Never fall back after an ambiguous Meta response.
        if (!(error instanceof ReelRenderError)) throw error;
        const snapshot = await prisma.pageSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { pageName: true, profilePicture: true } });
        const fallbackStyle = resolveVisualStyle("AUTO", `${content.title}:${content.id}`);
        const squareAsset = await createBrandedAsset({ title: content.title, pageName: snapshot?.pageName || "TutorLink Tuition Media", profilePicture: snapshot?.profilePicture || null, format: "POST", visualStyle: fallbackStyle });
        const fallback: PublishableContent = { ...content, format: "POST", assetUrl: squareAsset, script: null, visualStyle: fallbackStyle };
        const fallbackChecks = await runPublishChecks(fallback);
        if (!fallbackChecks.ok) throw new MetaApiError("The Reel could not be rendered and the photo fallback failed validation. Nothing was published.", 400);
        await prisma.contentItem.update({ where: { id: content.id }, data: { format: "POST", assetUrl: squareAsset, script: null, visualStyle: fallbackStyle } });
        effectiveFormat = "POST";
        fallbackFrom = "REEL_RENDER_FAILED";
        result = await publishPhoto(fallback, caption);
      }
    } else {
      result = await publishPhoto(content, caption);
    }
    const updated = await prisma.contentItem.update({ where: { id: content.id }, data: { status: "PUBLISHED", format: effectiveFormat, platformPostId: result.postId, publishedAt: new Date(), scheduledAt: null } });
    const variables: Array<[string, string | null]> = [["format", effectiveFormat], ["creativeAngle", content.creativeAngle], ["visualStyle", content.visualStyle]];
    await prisma.experiment.createMany({ data: variables.filter((pair): pair is [string, string] => Boolean(pair[1])).map(([experimentKey, variant]) => ({ contentItemId: content.id, experimentKey, variant })) }).catch(() => undefined);
    await prisma.auditEvent.create({ data: { actor, action: "FACEBOOK_CONTENT_PUBLISHED", entityType: "ContentItem", entityId: content.id, details: { postId: result.postId, mediaId: result.mediaId, mediaType: result.mediaType, processing: result.processing, fallbackFrom, publishedAt: updated.publishedAt } as never } });
    return { published: true, duplicate: false, contentId: content.id, postId: result.postId, mediaId: result.mediaId, mediaType: result.mediaType, format: effectiveFormat, fallbackFrom, publishedAt: updated.publishedAt };
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
