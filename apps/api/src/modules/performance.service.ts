import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { analyzePage } from "./meta/meta.service.js";
import { platformIdCandidates } from "./meta/webhook.service.js";

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function sumAvailable(posts: Array<{ insights?: Record<string, unknown> }>, key: string): number | null {
  const values = posts.map((post) => numeric(post.insights?.[key])).filter((value): value is number => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function summaryOf(rawSummary: unknown) {
  const summary = rawSummary as { page?: { name?: string }; posts?: Array<{ id?: string; message?: string; reactions?: number | null; comments?: number | null; shares?: number | null; insights?: Record<string, unknown>; insightsAvailable?: boolean }>; coverage?: { postCount?: number; insightsAvailable?: number } } | null;
  const posts = summary?.posts ?? [];
  const uniqueMediaViews = sumAvailable(posts, "post_total_media_view_unique");
  const mediaViews = sumAvailable(posts, "post_media_view");
  const engagement = posts.reduce((total, post) => total + (post.reactions ?? 0) + (post.comments ?? 0) + (post.shares ?? 0), 0);
  return {
    pageName: summary?.page?.name ?? null,
    postCount: summary?.coverage?.postCount ?? posts.length,
    insightsAvailable: summary?.coverage?.insightsAvailable ?? posts.filter((post) => post.insightsAvailable).length,
    uniqueMediaViews,
    mediaViews,
    visibleEngagements: engagement,
    posts: posts.map((post) => ({ id: post.id, message: post.message, uniqueMediaViews: numeric(post.insights?.post_total_media_view_unique), mediaViews: numeric(post.insights?.post_media_view), reactions: post.reactions ?? null, comments: post.comments ?? null, shares: post.shares ?? null, insightsAvailable: post.insightsAvailable ?? false })),
  };
}

export async function runPerformanceMonitor() {
  const fetched = await analyzePage();
  const snapshot = await prisma.pageSnapshot.create({
    data: {
      pageId: fetched.page.id,
      pageName: fetched.page.name,
      profilePicture: fetched.page.picture,
      permissionInfo: { checked: true, insightsAvailable: fetched.coverage.insightsAvailable, postCount: fetched.coverage.postCount } as never,
      rawSummary: fetched as never,
    },
  });

  // Store time-series metrics only when an imported Page post can be linked to an existing content item.
  // Draft-only content is not falsely attributed to a Facebook post.
  let linkedMetricsSaved = 0;
  for (const post of fetched.posts) {
    const content = await prisma.contentItem.findFirst({ where: { platformPostId: { in: platformIdCandidates(post.id) } }, select: { id: true } });
    if (!content) continue;
    const n = (key: string) => numeric(post.insights?.[key]);
    await prisma.contentMetric.create({ data: {
      contentItemId: content.id,
      reach: n("post_reach"),
      uniqueMediaViews: n("post_total_media_view_unique"),
      impressions: n("post_impressions"),
      views: n("post_media_view"),
      reactions: post.reactions,
      comments: post.comments,
      shares: post.shares,
      clicks: n("post_clicks"),
      raw: { postId: post.id, insightsAvailable: post.insightsAvailable, insights: post.insights } as never,
    } });
    linkedMetricsSaved++;
  }

  const now = new Date();
  const currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const [currentLeads, previousLeads, previousSnapshot] = await Promise.all([
    prisma.lead.findMany({ where: { createdAt: { gte: currentStart, lte: now } }, select: { status: true, sourceContentId: true } }),
    prisma.lead.findMany({ where: { createdAt: { gte: previousStart, lt: currentStart } }, select: { status: true, sourceContentId: true } }),
    prisma.pageSnapshot.findFirst({ where: { id: { not: snapshot.id }, pageId: fetched.page.id }, orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true, rawSummary: true } }),
  ]);
  const currentQualified = currentLeads.filter((lead) => lead.status === "QUALIFIED" || lead.status === "BOOKED").length;
  const previousQualified = previousLeads.filter((lead) => lead.status === "QUALIFIED" || lead.status === "BOOKED").length;
  const currentBooked = currentLeads.filter((lead) => lead.status === "BOOKED").length;
  const current = summaryOf(fetched);
  const previous = previousSnapshot ? summaryOf(previousSnapshot.rawSummary) : null;
  const previousUniqueViews = previous?.uniqueMediaViews;
  const currentUniqueViews = current.uniqueMediaViews;
  const uniqueViewsDropPercent = typeof previousUniqueViews === "number" && typeof currentUniqueViews === "number" && previousUniqueViews > 0 && currentUniqueViews < previousUniqueViews * 0.7 ? Math.round((1 - currentUniqueViews / previousUniqueViews) * 100) : null;
  const uniqueViewsDropped = uniqueViewsDropPercent !== null;
  const recommendations: Array<{ severity: "info" | "warning"; title: string; detail: string; action: string }> = [];

  if (current.insightsAvailable === 0) {
    recommendations.push({ severity: "warning", title: "Facebook insights unavailable", detail: "Meta returned recent posts but no usable media-view insights. Unique media views and views are unknown, not zero.", action: "Review Page access and granted insights permissions; do not optimize from missing metrics." });
  } else if (uniqueViewsDropped) {
    recommendations.push({ severity: "warning", title: "Unique media views are down", detail: `Unique media views for fetched posts are down about ${uniqueViewsDropPercent}% versus the previous saved snapshot. This is a sample, not exact Page reach.`, action: "Test a stronger first-line hook and a different useful guardian-focused topic; compare results at the next check." });
  }

  if (previousQualified > 0 && currentQualified < previousQualified * 0.7) {
    recommendations.push({ severity: "warning", title: "Qualified leads are down", detail: `Qualified or booked leads fell from ${previousQualified} to ${currentQualified} in comparable 7-day windows.`, action: "Prioritize posts that clarify class, subjects, location and tutor requirements; review lead follow-up speed and source attribution." });
  } else if (currentQualified === 0) {
    recommendations.push({ severity: "warning", title: "No qualified leads recorded this week", detail: "The system cannot optimize lead quality without outcomes being recorded in Qualified Leads.", action: "Record genuine enquiries and mark them Qualified, Unqualified or Booked; attribute a source content item whenever known." });
  } else {
    recommendations.push({ severity: "info", title: "Keep optimizing for lead quality", detail: `${currentQualified} qualified or booked leads were recorded in the last 7 days (${currentBooked} booked).`, action: "Continue tracking outcomes and use source-content attribution where possible before declaring a winning format." });
  }

  if (!previousSnapshot) recommendations.push({ severity: "info", title: "Building a baseline", detail: "This is the first saved monitoring snapshot, so a reliable trend comparison is not available yet.", action: "Let the daily monitor collect another snapshot and record lead outcomes; avoid strong conclusions from one observation." });
  if (currentLeads.some((lead) => !lead.sourceContentId)) recommendations.push({ severity: "info", title: "Lead attribution has gaps", detail: "Some recent leads are not linked to a source content item.", action: "When adding or updating a lead, select its source post/draft if known so future recommendations can compare lead quality by content." });

  const runId = `performance-${now.toISOString()}`;
  await prisma.agentDecision.create({ data: {
    runId,
    category: "PERFORMANCE_MONITOR",
    observation: {
      pageName: current.pageName, snapshotAt: snapshot.fetchedAt, previousSnapshotAt: previousSnapshot?.fetchedAt ?? null,
      current7DayLeads: currentLeads.length, previous7DayLeads: previousLeads.length,
      current7DayQualifiedOrBooked: currentQualified, previous7DayQualifiedOrBooked: previousQualified,
      current7DayBookings: currentBooked, uniqueMediaViews: current.uniqueMediaViews, uniqueMediaViewsDropped: uniqueViewsDropped, mediaViews: current.mediaViews,
      insightsAvailable: current.insightsAvailable, postCount: current.postCount, linkedMetricsSaved,
    } as never,
    hypothesis: recommendations.map((item) => `${item.title}: ${item.action}`).join(" ").slice(0, 1000),
    confidence: previousSnapshot ? 0.65 : 0.35,
    action: { recommendations, automaticPublishing: env.META_PUBLISH_MODE === "live", automaticStrategyChanges: true, nextCampaignUsesThisSnapshot: true } as never,
  } });
  await prisma.auditEvent.create({ data: {
    actor: "performance-monitor",
    action: "PERFORMANCE_MONITOR_COMPLETED",
    entityType: "PageSnapshot",
    entityId: snapshot.id,
    details: { pageName: current.pageName, postCount: current.postCount, insightsAvailable: current.insightsAvailable, current7DayQualifiedOrBooked: currentQualified, previous7DayQualifiedOrBooked: previousQualified, recommendationCount: recommendations.length } as never,
  } });

  return {
    snapshotId: snapshot.id,
    checkedAt: snapshot.fetchedAt,
    page: { id: fetched.page.id, name: fetched.page.name, profilePicture: fetched.page.picture },
    metrics: { postCount: current.postCount, insightsAvailable: current.insightsAvailable, uniqueMediaViews: current.uniqueMediaViews, mediaViews: current.mediaViews, visibleEngagements: current.visibleEngagements, linkedMetricsSaved },
    leads: { last7Days: currentLeads.length, qualifiedOrBookedLast7Days: currentQualified, bookedLast7Days: currentBooked, previous7Days: previousLeads.length, previousQualifiedOrBooked: previousQualified },
    trendAvailable: Boolean(previousSnapshot),
    dataLimitations: [
      "Meta may withhold Page/post insights depending on token permissions and API availability.",
      "Graph API v26 does not provide a dependable exact per-post reach metric here; unique media views are a proxy, not unique Page-wide people reached.",
      "Organic audience targeting cannot be guaranteed from aggregate analytics.",
      "Lead quality is only as complete as the enquiries and outcomes recorded in this workspace.",
      "The next autonomous campaign consumes these observations; unavailable metrics are never treated as zero.",
    ],
    recommendations,
  };
}

export async function getPerformanceSummary() {
  const [snapshots, recentDecisions, leads, content] = await Promise.all([
    prisma.pageSnapshot.findMany({ orderBy: { fetchedAt: "desc" }, take: 14, select: { id: true, pageId: true, pageName: true, fetchedAt: true, rawSummary: true } }),
    prisma.agentDecision.findMany({ where: { category: "PERFORMANCE_MONITOR" }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.lead.findMany({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }, select: { status: true, sourceContentId: true } }),
    prisma.contentItem.findMany({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 30, select: { id: true, title: true, topic: true, format: true, platformPostId: true, publishedAt: true, metrics: { orderBy: { observedAt: "desc" }, take: 1 } } }),
  ]);
  const latest = snapshots[0];
  const latestSummary = latest ? summaryOf(latest.rawSummary) : null;
  const latestDecision = recentDecisions[0];
  return {
    latestSnapshot: latest ? { id: latest.id, pageId: latest.pageId, pageName: latest.pageName, fetchedAt: latest.fetchedAt } : null,
    metrics: latestSummary ? { postCount: latestSummary.postCount, insightsAvailable: latestSummary.insightsAvailable, uniqueMediaViews: latestSummary.uniqueMediaViews, mediaViews: latestSummary.mediaViews, visibleEngagements: latestSummary.visibleEngagements } : null,
    history: snapshots.map((snapshot) => ({ id: snapshot.id, fetchedAt: snapshot.fetchedAt, pageName: snapshot.pageName, ...(() => { const s = summaryOf(snapshot.rawSummary); return { postCount: s.postCount, insightsAvailable: s.insightsAvailable, uniqueMediaViews: s.uniqueMediaViews, mediaViews: s.mediaViews, visibleEngagements: s.visibleEngagements }; })() })).reverse(),
    leads: { last7Days: leads.length, qualifiedOrBookedLast7Days: leads.filter((lead) => lead.status === "QUALIFIED" || lead.status === "BOOKED").length, bookedLast7Days: leads.filter((lead) => lead.status === "BOOKED").length, attributedLast7Days: leads.filter((lead) => Boolean(lead.sourceContentId)).length },
    latestRecommendations: latestDecision?.action && typeof latestDecision.action === "object" && latestDecision.action !== null && "recommendations" in latestDecision.action ? (latestDecision.action as { recommendations: unknown[] }).recommendations : [],
    decisions: recentDecisions.map((decision) => ({ id: decision.id, createdAt: decision.createdAt, confidence: decision.confidence, hypothesis: decision.hypothesis, observation: decision.observation, action: decision.action })),
    publishedContent: content,
    limitations: ["No insights means unavailable data, not zero performance.", "Graph API v26 unique media views are not the same as exact reach or unique Page-wide people.", "Only content linked to a Meta post ID can have its post metrics stored against a ContentItem.", "Lead quality depends on connected lead triage and corrections of AI classification.", "Organic targeting cannot guarantee that only guardians see a post or that a post produces leads."],
  };
}
