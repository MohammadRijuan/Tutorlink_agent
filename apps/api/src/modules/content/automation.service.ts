import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { classifyFailure } from "../../lib/retry.js";
import { generateDraft } from "./content.service.js";
import { decideNextContent } from "./agent-strategy.service.js";
import { buildCreativeForDraft } from "./creative.service.js";
import { assertAiBudget } from "../ai/ai.service.js";
import { evaluateCadence, forecastFirstPost } from "./cadence.js";
import { buildCreativeForDraft as buildCreative } from "./creative.service.js";
import { automationActive, getAutomationState } from "../agent-control.service.js";
import { publishContentItem, publishDueScheduledContent } from "../meta/publishing.service.js";
import { messengerBaseUrl } from "../meta/messenger-link.js";
import { MetaApiError } from "../meta/meta.service.js";

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

  // Frequency guard (a required quality gate): weekly cap, minimum gap, and the evidence-based rhythm (see cadence.ts).
  const oldestThisWeek = await prisma.contentItem.findFirst({ where: { status: "PUBLISHED", publishedAt: { gte: weekAgo } }, orderBy: { publishedAt: "asc" }, select: { publishedAt: true } });
  const verdict = evaluateCadence({ now, lastPublishedAt: lastPublished?.publishedAt ?? null, oldestPublishedInWindow: oldestThisWeek?.publishedAt ?? null, publishedLast7Days: publishedThisWeek, qualifiedLeadsLast7Days: qualified, minHoursBetweenPosts: env.MIN_HOURS_BETWEEN_POSTS, noLeadWaitHours: env.NO_LEAD_WAIT_HOURS, maxPostsPer7Days: env.MAX_POSTS_PER_7_DAYS });
  if (!verdict.allowed) return recordSkip(verdict.reason ?? "Cadence rules say wait.", { hoursSinceLastPost, qualifiedLeadsLast7Days: qualified, publishedThisWeek, requiredGapHours: verdict.requiredGapHours, earliestAt: verdict.earliestAt, reach: recentReach, engagement: recentEngagement });

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

  const { visualStyle, designPalette, assetUrl, linkAssetUrl } = await buildCreativeForDraft({ title: draft.title, subtitle: draft.subtitle, caption: draft.caption, format: decision.format });
  const content = await prisma.contentItem.create({ data: {
    title: draft.title, format: decision.format, topic: decision.topic, creativeAngle: decision.creativeAngle,
    visualStyle, designPalette, subtitle: draft.subtitle, language: "bn", caption: draft.caption, hashtags: asJson(draft.hashtags), callToAction: "মেসেঞ্জারে যোগাযোগ করুন",
    script: draft.script, reelScenes: draft.reelScenes ? asJson(draft.reelScenes) : undefined, assetUrl, linkAssetUrl, status: "DRAFT",
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


/** What the agent will do at its next scheduled run, and why. Read-only; powers the "Agent outlook" panels. */
export async function getCampaignOutlook(now = new Date()) {
  const state = await getAutomationState();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const [lastPublished, oldest, publishedLast7Days, leads, stuck, nextScheduled] = await Promise.all([
    prisma.contentItem.findFirst({ where: { status: "PUBLISHED", publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, select: { id: true, title: true, format: true, publishedAt: true } }),
    prisma.contentItem.findFirst({ where: { status: "PUBLISHED", publishedAt: { gte: weekAgo } }, orderBy: { publishedAt: "asc" }, select: { publishedAt: true } }),
    prisma.contentItem.count({ where: { status: "PUBLISHED", publishedAt: { gte: weekAgo } } }),
    prisma.lead.count({ where: { createdAt: { gte: weekAgo }, status: { in: ["QUALIFIED", "BOOKED"] } } }),
    prisma.contentItem.count({ where: { status: "PUBLISHING" } }),
    prisma.contentItem.findFirst({ where: { status: "SCHEDULED", scheduledAt: { gt: now }, platformPostId: null }, orderBy: { scheduledAt: "asc" }, select: { id: true, title: true, scheduledAt: true } }),
  ]);
  const input = { now, lastPublishedAt: lastPublished?.publishedAt ?? null, oldestPublishedInWindow: oldest?.publishedAt ?? null, publishedLast7Days, qualifiedLeadsLast7Days: leads, minHoursBetweenPosts: env.MIN_HOURS_BETWEEN_POSTS, noLeadWaitHours: env.NO_LEAD_WAIT_HOURS, maxPostsPer7Days: env.MAX_POSTS_PER_7_DAYS };
  const forecast = forecastFirstPost(input);
  const blockers: string[] = [];
  if (state.paused) blockers.push("Automation is paused.");
  if (!state.paused && !state.agentMode) blockers.push("Agent Mode is OFF, so the agent will not post by itself.");
  if (env.META_PUBLISH_MODE !== "live") blockers.push("Publishing is in dry-run mode (META_PUBLISH_MODE), so nothing goes to Facebook.");
  if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) blockers.push("Facebook Page ID / token are not configured.");
  try { messengerBaseUrl(); } catch { blockers.push("The verified Messenger URL (META_MESSENGER_URL) is missing."); }
  if (stuck > 0) blockers.push("A previous publish is stuck in Publishing: check the Page and click Confirm not on Facebook.");
  return {
    agentMode: !state.paused && state.agentMode, paused: state.paused, publishMode: env.META_PUBLISH_MODE,
    lastPost: lastPublished ? { id: lastPublished.id, title: lastPublished.title, format: lastPublished.format, publishedAt: lastPublished.publishedAt } : null,
    qualifiedLeadsLast7Days: leads, publishedLast7Days, requiredGapHours: forecast.verdictNow.requiredGapHours, leadMode: forecast.verdictNow.leadMode,
    nextRunAt: forecast.nextRunAt, willPostAtNextRun: blockers.length === 0 && forecast.willPostAtNextRun, firstPostAt: forecast.firstPostAt,
    reasonNow: forecast.verdictNow.reason, blockers, nextScheduled,
  };
}

/**
 * Human-triggered creation from the dashboard ("Create now"): choose Post or Reel, optionally a topic, and either save a preview or publish immediately.
 * It deliberately bypasses the posting-rhythm rules (a person asked) but never the safety checks: validation, claims, fonts, pre-publish checks and duplicate protection all still apply.
 */
export async function createContentNow(options: { format: "AUTO" | "POST" | "REEL"; topic?: string; guidance?: string; publish: boolean; actor: string }) {
  if (options.publish) {
    if (env.META_PUBLISH_MODE !== "live") throw new MetaApiError("Publishing is in dry-run mode. Set META_PUBLISH_MODE=live on the API project and redeploy, or create a preview instead.", 400);
    if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) throw new MetaApiError("Configure META_PAGE_ID and META_PAGE_ACCESS_TOKEN before publishing.", 400);
    messengerBaseUrl();
    const stuck = await prisma.contentItem.findFirst({ where: { status: "PUBLISHING" }, select: { id: true } });
    if (stuck) throw new MetaApiError("An earlier publish is stuck in Publishing. Check the Facebook Page, then click Confirm not on Facebook on that draft.", 409);
  }
  await assertAiBudget();
  const state = await getAutomationState();
  const guidance = options.guidance?.trim() || state.guidance;
  const decision = await decideNextContent(guidance);
  const format = options.format === "AUTO" ? decision.format : options.format;
  const topic = options.topic?.trim() ? options.topic.trim().slice(0, 200) : decision.topic;
  const recent = await prisma.contentItem.findMany({ orderBy: { createdAt: "desc" }, take: 40, select: { title: true, topic: true, format: true, caption: true, creativeAngle: true } });
  const draft = await generateDraft({ topic, format, audience: decision.audience, goal: decision.goal, creativeAngle: decision.creativeAngle, visualStyle: "AUTO", guidance, avoidRecent: recent });
  const { visualStyle, designPalette, assetUrl, linkAssetUrl } = await buildCreative({ title: draft.title, subtitle: draft.subtitle, caption: draft.caption, format });
  const content = await prisma.contentItem.create({ data: {
    title: draft.title, format, topic, creativeAngle: decision.creativeAngle, visualStyle, designPalette, subtitle: draft.subtitle, language: "bn", caption: draft.caption,
    hashtags: asJson(draft.hashtags), callToAction: "মেসেঞ্জারে যোগাযোগ করুন", script: draft.script, reelScenes: draft.reelScenes ? asJson(draft.reelScenes) : undefined, assetUrl, linkAssetUrl, status: "DRAFT",
  } });
  await prisma.agentDecision.create({ data: { runId: `manual-create-now-${content.id}`, category: "MANUAL_CONTENT_NOW", observation: asJson(decision.observation), hypothesis: `Created on request by ${options.actor}: ${options.format === "AUTO" ? "agent-chosen" : options.format} format${options.topic?.trim() ? ", operator-chosen topic" : ""}.`, confidence: decision.confidence, action: asJson({ contentId: content.id, topic, format, published: false, requestedPublish: options.publish }) } });
  await prisma.auditEvent.create({ data: { actor: options.actor, action: "CONTENT_CREATED_NOW", entityType: "ContentItem", entityId: content.id, details: asJson({ format, provider: draft.provider, model: draft.model, publishRequested: options.publish }) } });
  if (!options.publish) return { contentId: content.id, format, topic, published: false as const };
  const published = await publishContentItem(content.id, options.actor);
  await prisma.agentDecision.updateMany({ where: { runId: `manual-create-now-${content.id}` }, data: { outcome: asJson({ published: true, postId: published.postId }) } });
  return { contentId: content.id, format, topic, published: true as const, result: published };
}
