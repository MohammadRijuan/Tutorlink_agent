import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { classifyFailure } from "../../lib/retry.js";
import { generateDraft } from "./content.service.js";
import { decideNextContent } from "./agent-strategy.service.js";
import { createBrandedAsset, resolveVisualStyle } from "./asset.service.js";
import { assertAiBudget } from "../ai/ai.service.js";
import { automationActive, getAutomationState } from "../agent-control.service.js";
import { publishContentItem, publishDueScheduledContent } from "../meta/publishing.service.js";
import { messengerBaseUrl } from "../meta/messenger-link.js";

const asJson = (value: unknown) => value as never;
const STUCK_PUBLISHING_MINUTES = 10;

async function recordSkip(reason: string, observation: Record<string, unknown> = {}) {
  await prisma.agentDecision.create({ data: {
    runId: `campaign-skip-${new Date().toISOString().slice(0, 10)}-${randomUUID()}`,
    category: "PUBLISHING_CADENCE", observation: asJson(observation), hypothesis: reason.slice(0, 1000), confidence: 0.7,
    action: asJson({ published: false, reason }),
  } });
  return { skipped: true, reason, published: false };
}

/** One adaptive decision per daily Vercel Cron invocation. The agent may wait; it is never forced to post daily. */
export async function runAutonomousCampaign(now = new Date(), guidanceOverride?: string, options: { allowDryRunDraft?: boolean } = {}) {
  const state = await getAutomationState();
  if (!automationActive(state)) return recordSkip("Automation is paused or Agent Mode is off.");
  const livePublishing = env.META_PUBLISH_MODE === "live";
  if (!livePublishing && !options.allowDryRunDraft) return recordSkip("Publishing is in dry-run mode. The scheduled campaign will not create or publish public content.");
  if (livePublishing) {
    if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) return recordSkip("Live publishing needs a Page ID and Page access token.");
    try { messengerBaseUrl(); } catch { return recordSkip("Live publishing needs a verified Page Messenger URL (META_MESSENGER_URL, e.g. https://m.me/YourPage)."); }
  }

  // An item stuck in PUBLISHING means an earlier run died mid-publish: the media state is uncertain, so a human must look.
  const stuck = await prisma.contentItem.findFirst({ where: { status: "PUBLISHING", updatedAt: { lt: new Date(now.getTime() - STUCK_PUBLISHING_MINUTES * 60_000) } }, select: { id: true, title: true } });
  if (stuck) return recordSkip("An earlier publish attempt never finished, so its Facebook state is uncertain. Check the Page, then mark the item in Content Studio before the agent continues.", { contentId: stuck.id, title: stuck.title });

  // Publish operator-scheduled content first in live mode; a successful publish consumes today's publishing opportunity.
  const due = livePublishing ? await publishDueScheduledContent() : { published: false, reason: "dry-run-no-publish" };
  if (due.published) return { skipped: false, mode: "scheduled-content", published: due };

  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const [lastPublished, recentLeads, nextScheduled, publishedThisWeek] = await Promise.all([
    prisma.contentItem.findFirst({ where: { status: "PUBLISHED", publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, select: { id: true, title: true, format: true, publishedAt: true, metrics: { orderBy: { observedAt: "desc" }, take: 1, select: { reach: true, uniqueMediaViews: true, reactions: true, comments: true, shares: true } } } }),
    prisma.lead.findMany({ where: { createdAt: { gte: weekAgo } }, select: { status: true, sourceContentId: true } }),
    prisma.contentItem.findFirst({ where: { status: "SCHEDULED", scheduledAt: { gt: now }, platformPostId: null }, orderBy: { scheduledAt: "asc" }, select: { id: true, scheduledAt: true } }),
    prisma.contentItem.count({ where: { status: "PUBLISHED", publishedAt: { gte: weekAgo } } }),
  ]);
  if (nextScheduled?.scheduledAt && nextScheduled.scheduledAt.getTime() - now.getTime() < 24 * 3600000) return recordSkip("A future post is already scheduled within the next 24 hours; preserve spacing and avoid duplicate cadence.", { scheduledAt: nextScheduled.scheduledAt });
  const qualified = recentLeads.filter(lead => lead.status === "QUALIFIED" || lead.status === "BOOKED").length;
  const booked = recentLeads.filter(lead => lead.status === "BOOKED").length;
  const hoursSinceLastPost = lastPublished?.publishedAt ? (now.getTime() - lastPublished.publishedAt.getTime()) / 3600000 : null;
  const lastMetric = lastPublished?.metrics[0];
  const recentReach = lastMetric?.uniqueMediaViews ?? lastMetric?.reach ?? null;
  const recentEngagement = lastMetric ? (lastMetric.reactions ?? 0) + (lastMetric.comments ?? 0) + (lastMetric.shares ?? 0) : null;

  // Frequency guard (a required quality gate): hard caps first, then the evidence-based cadence.
  if (publishedThisWeek >= env.MAX_POSTS_PER_7_DAYS) return recordSkip(`The weekly limit of ${env.MAX_POSTS_PER_7_DAYS} posts has been reached.`, { publishedThisWeek });
  if (hoursSinceLastPost !== null && hoursSinceLastPost < env.MIN_HOURS_BETWEEN_POSTS) return recordSkip(`A post was published ${Math.round(hoursSinceLastPost)} hours ago; the minimum gap is ${env.MIN_HOURS_BETWEEN_POSTS} hours.`, { hoursSinceLastPost, qualifiedLeadsLast7Days: qualified });
  // Adaptive cadence: daily when lead outcomes exist, wait ~3 days between experiments when no qualified lead is recorded.
  if (qualified === 0 && hoursSinceLastPost !== null && hoursSinceLastPost < 71) {
    return recordSkip("No qualified/booked lead is recorded in the last 7 days. Wait before the next test, review lead attribution, and avoid increasing volume without evidence.", { hoursSinceLastPost, qualifiedLeadsLast7Days: qualified, reach: recentReach, engagement: recentEngagement });
  }

  try { await assertAiBudget(); }
  catch (error) { return recordSkip(classifyFailure(error).message, { aiBudget: "exhausted" }); }

  const guidance = guidanceOverride !== undefined ? guidanceOverride : state.guidance;
  const decision = await decideNextContent(guidance);
  const recent = await prisma.contentItem.findMany({ orderBy: { createdAt: "desc" }, take: 40, select: { title: true, topic: true, format: true, caption: true, creativeAngle: true } });

  let draft;
  try {
    draft = await generateDraft({
      topic: decision.topic, format: decision.format, audience: decision.audience, goal: decision.goal,
      creativeAngle: decision.creativeAngle, visualStyle: "AUTO", guidance, avoidRecent: recent,
    });
  } catch (error) {
    const failure = classifyFailure(error);
    await prisma.agentDecision.create({ data: { runId: `campaign-generation-failed-${now.toISOString()}-${randomUUID()}`, category: "CONTENT_GENERATION_FAILURE", observation: asJson({ topic: decision.topic, format: decision.format, category: failure.category }), hypothesis: failure.message.slice(0, 900), confidence: 0.8, action: asJson({ published: false, retryNextScheduledRun: failure.retryable || failure.category === "QUOTA_EXHAUSTED" }) } });
    if (failure.category === "QUOTA_EXHAUSTED") return { skipped: true, reason: failure.message, published: false };
    throw error;
  }

  const snapshot = await prisma.pageSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } });
  const summary = snapshot?.rawSummary as { page?: { name?: string; picture?: string | null } } | null;
  const recentStyles = await prisma.contentItem.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { visualStyle: true } });
  const visualStyle = resolveVisualStyle("AUTO", `${draft.title}:${draft.caption}:${randomUUID()}`, recentStyles.map(item => item.visualStyle || ""));
  const assetUrl = await createBrandedAsset({ title: draft.title, pageName: summary?.page?.name || snapshot?.pageName || "TutorLink Tuition Media", profilePicture: summary?.page?.picture || snapshot?.profilePicture || null, format: decision.format, visualStyle });
  const content = await prisma.contentItem.create({ data: {
    title: draft.title, format: decision.format, topic: decision.topic, creativeAngle: decision.creativeAngle,
    visualStyle, language: "bn", caption: draft.caption, hashtags: asJson(draft.hashtags), callToAction: "মেসেঞ্জারে যোগাযোগ করুন",
    script: draft.script, reelScenes: draft.reelScenes ? asJson(draft.reelScenes) : undefined, assetUrl, status: "DRAFT",
  } });
  const runId = `autonomous-campaign-${now.toISOString().slice(0, 10)}-${content.id}`;
  const fallbackFrom = "fallbackFrom" in draft ? draft.fallbackFrom || null : null;
  await prisma.agentDecision.create({ data: {
    runId, category: "AUTONOMOUS_CONTENT_AND_PUBLISH",
    observation: asJson({ ...decision.observation, qualifiedLeadsLast7Days: qualified, bookedLeadsLast7Days: booked, hoursSinceLastPost, publishedLast7Days: publishedThisWeek, lastPostUniqueMediaViews: recentReach, lastPostEngagement: recentEngagement }),
    hypothesis: decision.rationale.slice(0, 1000), confidence: decision.confidence,
    action: asJson({ contentId: content.id, topic: decision.topic, format: decision.format, creativeAngle: decision.creativeAngle, visualStyle, published: false, guidanceApplied: Boolean(guidance) }),
  } });
  await prisma.auditEvent.create({ data: { actor: "autonomous-agent", action: "AUTONOMOUS_CONTENT_CREATED", entityType: "ContentItem", entityId: content.id, details: asJson({ topic: decision.topic, format: decision.format, provider: draft.provider, model: draft.model, fallbackFrom, confidence: decision.confidence }) } });

  // Dry-run from Content Studio saves a real preview without contacting Meta. The daily Cron never creates a pile of dry-run drafts.
  if (!livePublishing) {
    const reason = "Dry-run mode: the agent saved a preview draft; no Facebook post was published.";
    await prisma.agentDecision.updateMany({ where: { runId }, data: { outcome: asJson({ published: false, dryRun: true, contentId: content.id, reason }) } });
    return { skipped: false, mode: "dry-run", contentId: content.id, topic: decision.topic, format: decision.format, rationale: decision.rationale, confidence: decision.confidence, provider: draft.provider, model: draft.model, fallbackFrom, reason, published: { published: false, reason } };
  }
  // Publish within the same protected cron execution. publishContentItem re-checks Agent Mode, so a human toggling OFF mid-run wins.
  try {
    const published = await publishContentItem(content.id, "autonomous-agent");
    await prisma.agentDecision.updateMany({ where: { runId }, data: { outcome: asJson({ published: true, postId: published.postId, mediaType: "mediaType" in published ? published.mediaType : null, publishedAt: "publishedAt" in published ? published.publishedAt : null }) } });
    return { skipped: false, mode: "autonomous-publish", contentId: content.id, topic: decision.topic, format: decision.format, rationale: decision.rationale, confidence: decision.confidence, provider: draft.provider, model: draft.model, fallbackFrom, published };
  } catch (error) {
    await prisma.agentDecision.updateMany({ where: { runId }, data: { outcome: asJson({ published: false, error: classifyFailure(error).message.slice(0, 300), draftKept: true }) } });
    throw error;
  }
}

/** Backwards-compatible alias for older cron clients. */
export async function generateScheduledDraft(now = new Date(), guidanceOverride?: string) {
  return runAutonomousCampaign(now, guidanceOverride, { allowDryRunDraft: false });
}
