import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { classifyInboundLeadMessage } from "./lead-classifier.service.js";
import { parseContentRef } from "./messenger-link.js";

type Attribution = { contentId: string; confidence: number; via: "ref" | "post" | "recent-referral" };
const REFERRAL_WINDOW_MS = 14 * 24 * 3600_000;

function safeText(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 3000) : "";
}

/** All identifiers Meta may use for the same post/video: "pageId_postId", "postId", or a video id. */
export function platformIdCandidates(...ids: unknown[]): string[] {
  const out = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== "string" || !raw) continue;
    out.add(raw);
    const suffix = raw.split("_").pop();
    if (suffix) { out.add(suffix); if (env.META_PAGE_ID) out.add(`${env.META_PAGE_ID}_${suffix}`); }
  }
  return [...out];
}

async function resolveAttribution(input: { ref?: string; platformIds?: string[]; senderId: string }): Promise<Attribution | null> {
  const refId = parseContentRef(input.ref);
  if (refId) {
    const content = await prisma.contentItem.findUnique({ where: { id: refId }, select: { id: true } });
    if (content) return { contentId: content.id, confidence: 0.95, via: "ref" };
  }
  if (input.platformIds?.length) {
    const content = await prisma.contentItem.findFirst({ where: { platformPostId: { in: input.platformIds } }, select: { id: true } });
    if (content) return { contentId: content.id, confidence: 0.85, via: "post" };
  }
  const referral = await prisma.metaWebhookEvent.findFirst({ where: { senderId: input.senderId, eventType: "MESSENGER_REFERRAL", receivedAt: { gte: new Date(Date.now() - REFERRAL_WINDOW_MS) } }, orderBy: { receivedAt: "desc" }, select: { postId: true } });
  const recentRef = referral?.postId?.startsWith("ref:") ? referral.postId.slice(4) : null;
  if (recentRef) {
    const content = await prisma.contentItem.findUnique({ where: { id: recentRef }, select: { id: true } });
    if (content) return { contentId: content.id, confidence: 0.8, via: "recent-referral" };
  }
  return null;
}

/** A click on a post's Messenger link (m.me/...?ref=tl_<id>) arrives as a referral, possibly before any text. We remember it for attribution. */
async function recordReferral(input: { senderId: string; ref: string; timestamp: unknown }) {
  const contentId = parseContentRef(input.ref);
  if (!contentId) return { ignored: true as const, reason: "foreign-referral" };
  const exists = await prisma.contentItem.findUnique({ where: { id: contentId }, select: { id: true } });
  if (!exists) return { ignored: true as const, reason: "unknown-content" };
  try {
    await prisma.metaWebhookEvent.create({ data: { eventId: `referral:${input.senderId}:${contentId}:${String(input.timestamp ?? Date.now())}`, eventType: "MESSENGER_REFERRAL", senderId: input.senderId, postId: `ref:${contentId}` } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return { duplicate: true as const };
    throw error;
  }
  // If a lead already exists for this person without a source, attribute it now.
  await prisma.lead.updateMany({ where: { externalReference: `messenger:${input.senderId}`, sourceContentId: null }, data: { sourceContentId: contentId, attributionConfidence: 0.9 } });
  return { processed: true as const };
}

async function recordInbound(input: { eventId: string; eventType: string; senderId: string; postId?: string; platformIds?: string[]; ref?: string; text: string }) {
  if (!input.text) return { ignored: true, reason: "no-text-content" };
  const senderRef = `messenger:${input.senderId}`;
  const alreadyStored = await prisma.metaWebhookEvent.findUnique({ where: { eventId: input.eventId }, select: { id: true } });
  if (alreadyStored) return { duplicate: true };
  const classification = await classifyInboundLeadMessage(input.text);
  try {
    return await prisma.$transaction(async tx => {
      await tx.metaWebhookEvent.create({ data: { eventId: input.eventId, eventType: input.eventType, senderId: input.senderId, postId: input.postId || null, messageText: input.text } });
      const source = await resolveAttribution({ ref: input.ref, platformIds: input.platformIds, senderId: input.senderId });
      const existing = await tx.lead.findFirst({ where: { externalReference: senderRef, status: { not: "LOST" } }, orderBy: { updatedAt: "desc" } });
      if (existing) {
        const notes = [existing.notes, `Messenger update: ${input.text}`].filter(Boolean).join("\n").slice(-6000);
        await tx.lead.update({ where: { id: existing.id }, data: { notes, sourceContentId: existing.sourceContentId || source?.contentId || undefined, attributionConfidence: existing.sourceContentId ? undefined : source ? source.confidence : undefined, status: existing.status === "NEW" && classification.status !== "NEW" ? classification.status : undefined, qualificationScore: ["NEW", "CONTACTED"].includes(existing.status) && classification.score > 0 ? classification.score : undefined, qualificationReason: ["NEW", "CONTACTED"].includes(existing.status) ? classification.reason : undefined } });
        return { duplicate: false, leadId: existing.id, updated: true };
      }
      const lead = await tx.lead.create({ data: {
        externalReference: senderRef, contactChannel: "MESSENGER", status: classification.status,
        qualificationReason: classification.reason, qualificationScore: classification.score,
        notes: input.text, sourceContentId: source?.contentId, attributionConfidence: source ? source.confidence : null,
      } });
      return { duplicate: false, leadId: lead.id, created: true, attributed: Boolean(source) };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return { duplicate: true };
    throw error;
  }
}

type MessagingEvent = {
  sender?: { id?: string }; timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; referral?: { ref?: string } };
  referral?: { ref?: string };
  postback?: { referral?: { ref?: string } };
};

/** Ingests Page Messenger messages, referrals and feed comments. It never auto-replies and only ever labels a lead QUALIFIED when the AI is confident. */
export async function ingestMetaWebhook(payload: unknown) {
  if (!payload || typeof payload !== "object") return { accepted: false, processed: 0 };
  const root = payload as { object?: string; entry?: Array<{ id?: string; messaging?: MessagingEvent[]; changes?: Array<{ field?: string; value?: Record<string, any> }> }> };
  if (root.object !== "page" || !Array.isArray(root.entry)) return { accepted: true, processed: 0, ignored: true };
  let processed = 0;
  let duplicates = 0;
  const tally = (result: Record<string, unknown>) => { if (result.duplicate) duplicates++; else if (!result.ignored) processed++; };
  for (const entry of root.entry) {
    if (env.META_PAGE_ID && entry.id !== env.META_PAGE_ID) continue;
    for (const event of entry.messaging || []) {
      const senderId = event.sender?.id;
      if (!senderId || senderId === env.META_PAGE_ID) continue;
      const referral = event.referral ?? event.postback?.referral ?? event.message?.referral;
      if (referral?.ref) tally(await recordReferral({ senderId, ref: referral.ref, timestamp: event.timestamp }));
      const message = event.message;
      if (!message?.mid || message.is_echo) continue;
      tally(await recordInbound({ eventId: `message:${message.mid}`, eventType: "MESSENGER_MESSAGE", senderId, ref: referral?.ref, text: safeText(message.text) }));
    }
    for (const change of entry.changes || []) {
      if (change.field !== "feed") continue;
      const value = change.value || {};
      if ((value.item && value.item !== "comment") || (value.verb && value.verb !== "add")) continue;
      const commentId = typeof value.comment_id === "string" ? value.comment_id : typeof value.id === "string" && value.item === "comment" ? value.id : undefined;
      const senderId = (value.from as { id?: string } | undefined)?.id;
      if (!commentId || !senderId || senderId === env.META_PAGE_ID) continue; // The Page's own replies are not enquiries.
      const text = safeText(value.message);
      const platformIds = platformIdCandidates(value.post_id, value.video_id);
      tally(await recordInbound({ eventId: `comment:${commentId}`, eventType: "PAGE_COMMENT", senderId, postId: platformIds[0], platformIds, text }));
    }
  }
  return { accepted: true, processed, duplicates };
}
