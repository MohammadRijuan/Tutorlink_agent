import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { analyzePage, MetaApiError } from "./meta/meta.service.js";
import { publishContentItem } from "./meta/publishing.service.js";
import { runAutonomousCampaign } from "./content/automation.service.js";
import { CREATIVE_ANGLES, VISUAL_STYLES, generateDraft } from "./content/content.service.js";
import { decideNextContent } from "./content/agent-strategy.service.js";
import { buildCreativeForDraft } from "./content/creative.service.js";
import { getAiUsage, runAiSelfTest, configuredChain } from "./ai/ai.service.js";
import { businessProfileSchema, getBusinessProfile, saveBusinessProfile } from "./business/business.service.js";
import { runPublishChecks } from "./meta/publish-checks.js";
import { buildFinalCaption } from "./meta/publishing.service.js";
import { resolveReelFrameTexts } from "./meta/reel-frames.js";
import { getAutomationState } from "./agent-control.service.js";
import { getPerformanceSummary, runPerformanceMonitor } from "./performance.service.js";
import { durableJobSchemaAvailable, enqueueContentGeneration, getContentJob, listContentJobs, requestContentJobRetry } from "./jobs/jobs.service.js";
import { classifyFailure } from "../lib/retry.js";

export const workspaceRouter = Router();
const asJson = (value: unknown) => value as never;
const asyncRoute = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);

workspaceRouter.get("/settings", asyncRoute(async (_req, res) => {
  const state = await getAutomationState();
  const [usage, publishing, processing] = await Promise.all([getAiUsage(), prisma.contentItem.count({ where: { status: "PUBLISHING" } }), prisma.jobRun.count({ where: { status: "PROCESSING" } }).catch(() => 0)]);
  const contentChain = configuredChain("content");
  return res.json({
    globalAutomationPaused: state.paused, agentMode: !state.paused && state.agentMode, publishMode: env.META_PUBLISH_MODE, guidanceConfigured: Boolean(state.guidance),
    inFlight: { publishing, generationJobs: processing },
    limits: { maxPostsPer7Days: env.MAX_POSTS_PER_7_DAYS, minHoursBetweenPosts: env.MIN_HOURS_BETWEEN_POSTS },
    integrations: {
      metaConfigured: Boolean(env.META_PAGE_ID && env.META_PAGE_ACCESS_TOKEN), messengerConfigured: Boolean(env.META_MESSENGER_URL), reelRendererConfigured: true,
      aiConfigured: env.AI_PROVIDER === "template" || contentChain.length > 0, aiProvider: env.AI_PROVIDER,
      aiModel: env.AI_PROVIDER === "template" ? "template" : contentChain[0] ? `${contentChain[0].provider}:${contentChain[0].model}` : "none",
      aiChain: contentChain.map(entry => `${entry.provider}:${entry.model}`), aiUsage: usage,
    },
  });
}));

workspaceRouter.get("/ai/status", asyncRoute(async (_req, res) => res.json({ content: configuredChain("content"), classifier: configuredChain("classifier"), usage: await getAiUsage() })));
workspaceRouter.post("/ai/self-test", asyncRoute(async (req, res) => {
  const result = await runAiSelfTest();
  await prisma.auditEvent.create({ data: { actor: req.adminUser?.email || "admin", action: "AI_SELF_TEST", details: asJson({ results: result.rows.map(row => ({ model: `${row.provider}:${row.model}`, ok: row.ok, category: row.category ?? null })) }) } });
  return res.json({ data: result.rows, usage: await getAiUsage() });
}));

workspaceRouter.get("/business-profile", asyncRoute(async (_req, res) => res.json({ data: await getBusinessProfile() })));
workspaceRouter.put("/business-profile", asyncRoute(async (req, res) => {
  const parsed = businessProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Check the business profile fields (name, description and short list items)." } });
  await saveBusinessProfile(parsed.data);
  await prisma.auditEvent.create({ data: { actor: req.adminUser?.email || "admin", action: "BUSINESS_PROFILE_UPDATED", details: asJson({ serviceAreas: parsed.data.serviceAreas.length, trustedFacts: parsed.data.trustedFacts.length, prohibitedClaims: parsed.data.prohibitedClaims.length }) } });
  return res.json({ data: await getBusinessProfile(), saved: true });
}));

workspaceRouter.patch("/settings/safety", asyncRoute(async (req, res) => {
  const schema = z.object({ globalAutomationPaused: z.boolean().optional(), agentMode: z.boolean().optional(), confirmation: z.string().optional() }).refine(v => v.globalAutomationPaused !== undefined || v.agentMode !== undefined);
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Provide a valid safety setting." } });
  const body = parsed.data;
  const actor = req.adminUser?.email || "admin";
  if (body.agentMode === true && body.confirmation !== "ENABLE_AGENT_MODE") return res.status(400).json({ error: { message: "Explicit confirmation is required to enable Agent Mode." } });
  const current = await prisma.systemSetting.findMany({ where: { key: { in: ["globalAutomationPaused", "agentMode"] } } });
  const previous = Object.fromEntries(current.map(e => [e.key, e.value]));
  const paused = body.globalAutomationPaused ?? (previous.globalAutomationPaused !== false);
  const agentMode = paused ? false : (body.agentMode ?? previous.agentMode === true);
  await prisma.systemSetting.upsert({ where: { key: "globalAutomationPaused" }, create: { key: "globalAutomationPaused", value: paused }, update: { value: paused } });
  await prisma.systemSetting.upsert({ where: { key: "agentMode" }, create: { key: "agentMode", value: agentMode }, update: { value: agentMode } });
  await prisma.auditEvent.create({ data: { actor, action: "SAFETY_SETTINGS_UPDATED", details: asJson({ previous: { globalAutomationPaused: previous.globalAutomationPaused ?? true, agentMode: previous.agentMode ?? false }, current: { globalAutomationPaused: paused, agentMode }, note: "Agent Mode controls the autonomous campaign. Live publishing requires META_PUBLISH_MODE=live and verified Meta credentials." }) } });
  return res.json({ globalAutomationPaused: paused, agentMode, publishMode: env.META_PUBLISH_MODE, note: "When live mode and verified credentials are configured, the daily campaign agent can publish automatically." });
}));

workspaceRouter.post("/campaign/run", asyncRoute(async (req, res) => {
  const parsed = z.object({ guidance: z.string().trim().max(1800).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Guidance must be 1,800 characters or fewer." } });
  if (parsed.data.guidance !== undefined) {
    await prisma.systemSetting.upsert({ where: { key: "agentGuidance" }, create: { key: "agentGuidance", value: parsed.data.guidance }, update: { value: parsed.data.guidance } });
  }
  try {
    const result = await runAutonomousCampaign(new Date(), parsed.data.guidance, { allowDryRunDraft: true });
    return res.json({ data: result });
  } catch (error) {
    if (error instanceof MetaApiError) return res.status(error.status).json({ error: { code: "CAMPAIGN_FAILED", message: error.message } });
    const failure = classifyFailure(error);
    return res.status(502).json({ error: { code: failure.category, message: failure.message } });
  }
}));

workspaceRouter.get("/agent/guidance", asyncRoute(async (_req, res) => {
  const setting = await prisma.systemSetting.findUnique({ where: { key: "agentGuidance" } });
  return res.json({ guidance: typeof setting?.value === "string" ? setting.value : "" });
}));
workspaceRouter.put("/agent/guidance", asyncRoute(async (req, res) => {
  const parsed = z.object({ guidance: z.string().trim().max(1800).default("") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Guidance must be 1,800 characters or fewer." } });
  const setting = await prisma.systemSetting.upsert({ where: { key: "agentGuidance" }, create: { key: "agentGuidance", value: parsed.data.guidance }, update: { value: parsed.data.guidance } });
  await prisma.auditEvent.create({ data: { actor: req.adminUser?.email || "admin", action: "AGENT_GUIDANCE_UPDATED", details: asJson({ guidanceLength: parsed.data.guidance.length, guidanceEnabled: Boolean(parsed.data.guidance) }) } });
  return res.json({ guidance: typeof setting.value === "string" ? setting.value : "", saved: true });
}));

workspaceRouter.get("/page/snapshots", asyncRoute(async (_req, res) => {
  const snapshots = await prisma.pageSnapshot.findMany({ orderBy: { fetchedAt: "desc" }, take: 10 });
  return res.json({ data: snapshots.map(s => ({ id: s.id, pageId: s.pageId, pageName: s.pageName, fetchedAt: s.fetchedAt, permissionInfo: s.permissionInfo, summary: s.rawSummary })) });
}));
workspaceRouter.post("/page/analyze", asyncRoute(async (_req, res) => {
  try {
    const result = await analyzePage();
    await prisma.pageSnapshot.create({ data: { pageId: result.page.id, pageName: result.page.name, profilePicture: result.page.picture, permissionInfo: asJson({ checked: true, insightsAvailable: result.coverage.insightsAvailable, postCount: result.coverage.postCount }), rawSummary: asJson(result) } });
    return res.json(result);
  } catch (error) {
    if (error instanceof MetaApiError) return res.status(error.status).json({ error: { message: error.message, code: "META_ANALYSIS_FAILED" } });
    throw error;
  }
}));

workspaceRouter.get("/performance", asyncRoute(async (_req, res) => {
  return res.json(await getPerformanceSummary());
}));
workspaceRouter.post("/performance/monitor", asyncRoute(async (_req, res) => {
  try {
    return res.json({ data: await runPerformanceMonitor(), publishing: "disabled" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Performance monitoring failed.";
    return res.status(502).json({ error: { code: "PERFORMANCE_MONITOR_FAILED", message } });
  }
}));

workspaceRouter.get("/content", asyncRoute(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const validStatuses = ["IDEA", "DRAFT", "VALIDATED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "PAUSED"];
  const data = await prisma.contentItem.findMany({ where: status && validStatuses.includes(status) ? { status: status as never } : undefined, orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }], take: 30 });
  return res.json({ data });
}));
workspaceRouter.get("/jobs", asyncRoute(async (req, res) => {
  const parsed = z.coerce.number().int().min(1).max(50).default(20).safeParse(req.query.limit);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid job list limit." } });
  if (!(await durableJobSchemaAvailable())) return res.json({ data: [], durableQueueEnabled: false });
  return res.json({ data: await listContentJobs(parsed.data) });
}));

workspaceRouter.get("/jobs/:id", asyncRoute(async (req, res) => {
  if (!(await durableJobSchemaAvailable())) return res.status(503).json({ error: { message: "Durable generation jobs are unavailable until the reviewed database migration is applied." } });
  const job = await getContentJob(req.params.id);
  if (!job) return res.status(404).json({ error: { message: "Content job not found." } });
  return res.json({ data: job });
}));

workspaceRouter.post("/jobs/:id/retry", asyncRoute(async (req, res) => {
  if (!(await durableJobSchemaAvailable())) return res.status(503).json({ error: { message: "Durable generation jobs are unavailable until the reviewed database migration is applied." } });
  const job = await requestContentJobRetry(req.params.id);
  if (!job) return res.status(409).json({ error: { message: "This job is not eligible for manual retry. Resolve any configuration, permission, or quota blocker first." } });
  return res.json({ data: job });
}));

async function getRecentDraftReferences() {
  return prisma.contentItem.findMany({
    orderBy: { createdAt: "desc" }, take: 40,
    select: { title: true, topic: true, format: true, caption: true, creativeAngle: true },
  });
}

workspaceRouter.post("/content/generate", asyncRoute(async (req, res) => {
  const schema = z.object({
    topic: z.string().trim().min(3).max(180),
    format: z.enum(["POST", "REEL"]),
    audience: z.string().max(180).optional(),
    goal: z.string().max(180).optional(),
    creativeAngle: z.enum(CREATIVE_ANGLES).optional(),
    visualStyle: z.enum(VISUAL_STYLES).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Add a topic and choose Post or Reel." } });
  const keyHeader = req.header("idempotency-key");
  const requestKey = keyHeader
    ? z.string().trim().min(8).max(120).safeParse(keyHeader)
    : { success: true as const, data: randomUUID() };
  if (!requestKey.success) return res.status(400).json({ error: { message: "Idempotency-Key must contain between 8 and 120 characters." } });
  if (!(await durableJobSchemaAvailable())) {
    const actor = req.adminUser?.email || "admin";
    let draft;
    try {
      draft = await generateDraft({ ...parsed.data, avoidRecent: await getRecentDraftReferences() });
    } catch (error) {
      const failure = classifyFailure(error);
      const status = failure.category === "RATE_LIMITED" || failure.category === "QUOTA_EXHAUSTED"
        ? 429
        : ["CONFIGURATION", "AUTHENTICATION", "PERMISSION_DENIED"].includes(failure.category)
          ? 503
          : 502;
      return res.status(status).json({ error: { code: failure.category, message: failure.message } });
    }
    const { visualStyle, assetUrl } = await buildCreativeForDraft({ title: draft.title, caption: draft.caption, format: parsed.data.format, requestedStyle: parsed.data.visualStyle });
    const content = await prisma.contentItem.create({
      data: {
        title: draft.title,
        format: parsed.data.format,
        topic: parsed.data.topic,
        creativeAngle: parsed.data.creativeAngle || "AUTO",
        visualStyle,
        language: "bn",
        caption: draft.caption,
        hashtags: asJson(draft.hashtags),
        callToAction: "মেসেঞ্জারে যোগাযোগ করুন",
        script: draft.script,
        reelScenes: draft.reelScenes ? asJson(draft.reelScenes) : undefined,
        assetUrl,
        status: "DRAFT",
      },
    });
    await prisma.auditEvent.create({
      data: { actor, action: "CONTENT_DRAFT_GENERATED", entityType: "ContentItem", entityId: content.id, details: asJson({ provider: draft.provider, model: draft.model, format: parsed.data.format, creativeAngle: parsed.data.creativeAngle || "AUTO", visualStyle, durableQueueAvailable: false }) },
    });
    return res.status(201).json({
      data: content,
      mode: "synchronous",
      generation: { provider: draft.provider, model: draft.model, warning: "Saved immediately because the durable-job migration is not installed. This draft was not published." },
    });
  }
  const result = await enqueueContentGeneration(parsed.data, req.adminUser?.id || "admin", requestKey.data);
  return res.status(result.duplicate ? 200 : 202).json({ data: result.job, duplicate: result.duplicate });
}));
workspaceRouter.post("/content/agent-generate", asyncRoute(async (req, res) => {
  const parsed = z.object({ guidance: z.string().trim().max(1800).optional().default("") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Keep the optional guidance under 1,800 characters." } });
  const actor = req.adminUser?.email || "admin";
  const keyHeader = req.header("idempotency-key");
  const requestKey = keyHeader ? z.string().trim().min(8).max(120).safeParse(keyHeader) : { success: true as const, data: randomUUID() };
  if (!requestKey.success) return res.status(400).json({ error: { message: "Idempotency-Key must contain between 8 and 120 characters." } });
  const runId = `agent-content-${requestKey.data}`;
  const previousDecision = await prisma.agentDecision.findFirst({ where: { runId }, orderBy: { createdAt: "desc" } });
  if (previousDecision) {
    const previousAction = previousDecision.action as { contentId?: string; topic?: string; format?: string; creativeAngle?: string; visualStyle?: string; guidance?: string | null };
    if (previousAction.contentId) {
      const previousContent = await prisma.contentItem.findUnique({ where: { id: previousAction.contentId } });
      if (previousContent) return res.status(200).json({ data: previousContent, duplicate: true, publishing: "disabled", decision: { topic: previousAction.topic, format: previousAction.format, creativeAngle: previousAction.creativeAngle, visualStyle: previousAction.visualStyle, rationale: previousDecision.hypothesis, confidence: previousDecision.confidence } });
    }
  }
  const decision = await decideNextContent(parsed.data.guidance);
  const input = {
    topic: decision.topic,
    format: decision.format,
    audience: decision.audience,
    goal: decision.goal,
    guidance: parsed.data.guidance,
    creativeAngle: decision.creativeAngle,
    visualStyle: decision.visualStyle,
  };

  // Bounded synchronous path for the interactive Content Studio (the AI layer enforces the daily request budget).
  const recentDrafts = await getRecentDraftReferences();
  let draft;
  try {
    draft = await generateDraft({ ...input, avoidRecent: recentDrafts });
  } catch (error) {
    const failure = classifyFailure(error);
    const status = failure.category === "RATE_LIMITED" || failure.category === "QUOTA_EXHAUSTED"
      ? 429
      : ["CONFIGURATION", "AUTHENTICATION", "PERMISSION_DENIED"].includes(failure.category) ? 503 : 502;
    return res.status(status).json({ error: { code: failure.category, message: failure.message } });
  }
  const { visualStyle, assetUrl } = await buildCreativeForDraft({ title: draft.title, caption: draft.caption, format: input.format });
  const content = await prisma.contentItem.create({ data: { title: draft.title, format: input.format, topic: input.topic, creativeAngle: input.creativeAngle, visualStyle, language: "bn", caption: draft.caption, hashtags: asJson(draft.hashtags), callToAction: "মেসেঞ্জারে যোগাযোগ করুন", script: draft.script, reelScenes: draft.reelScenes ? asJson(draft.reelScenes) : undefined, assetUrl, status: "DRAFT" } });
  await prisma.agentDecision.create({ data: { runId, category: "CONTENT_SELECTION", observation: asJson(decision.observation), hypothesis: decision.rationale.slice(0, 1000), confidence: decision.confidence, action: asJson({ contentId: content.id, topic: decision.topic, format: decision.format, creativeAngle: decision.creativeAngle, visualStyle, guidance: parsed.data.guidance || null, published: false }) } });
  await prisma.auditEvent.create({ data: { actor, action: "AGENT_CONTENT_SELECTED", entityType: "ContentItem", entityId: content.id, details: asJson({ topic: decision.topic, format: decision.format, creativeAngle: decision.creativeAngle, confidence: decision.confidence, provider: draft.provider, model: draft.model }) } });
  return res.status(201).json({ data: content, decision: { topic: decision.topic, format: decision.format, creativeAngle: decision.creativeAngle, visualStyle, rationale: decision.rationale, confidence: decision.confidence, observation: decision.observation }, mode: "synchronous", publishing: "disabled", generation: { provider: draft.provider, model: draft.model, warning: "Draft saved; nothing was published. Generation is synchronous in Content Studio so it can run on Vercel Hobby without a frequent worker cron." } });
}));

workspaceRouter.post("/content", asyncRoute(async (req, res) => {
  const schema = z.object({ title: z.string().min(1).max(180), topic: z.string().min(1).max(180), format: z.enum(["POST", "REEL"]), creativeAngle: z.enum(CREATIVE_ANGLES).optional(), visualStyle: z.enum(VISUAL_STYLES).optional(), caption: z.string().min(1).max(10000), script: z.string().max(10000).optional(), hashtags: z.array(z.string().max(80)).max(12).default([]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid content draft." } });
  const data = await prisma.contentItem.create({ data: { ...parsed.data, language: "bn", hashtags: asJson(parsed.data.hashtags), callToAction: "মেসেঞ্জারে যোগাযোগ করুন", status: "DRAFT" } });
  return res.status(201).json({ data });
}));
workspaceRouter.post("/content/:id/publish", asyncRoute(async (req, res) => {
  try {
    const result = await publishContentItem(req.params.id, req.adminUser?.email || "admin");
    return res.json({ data: result });
  } catch (error) {
    if (error instanceof MetaApiError) return res.status(error.status).json({ error: { code: "FACEBOOK_PUBLISH_FAILED", message: error.message } });
    throw error;
  }
}));

workspaceRouter.get("/content/:id/checks", asyncRoute(async (req, res) => {
  const content = await prisma.contentItem.findUnique({ where: { id: req.params.id } });
  if (!content) return res.status(404).json({ error: { message: "Content item was not found." } });
  const readiness = await runPublishChecks(content);
  let finalCaption: string | null = null;
  try { finalCaption = buildFinalCaption(content.caption, content.id); } catch { /* Messenger URL not configured: reported by the checks. */ }
  return res.json({ data: { ...readiness, finalCaption, reelFrames: content.format === "REEL" ? resolveReelFrameTexts(content) : null, publishMode: env.META_PUBLISH_MODE } });
}));
workspaceRouter.post("/content/:id/resolve-publishing", asyncRoute(async (req, res) => {
  const content = await prisma.contentItem.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, platformPostId: true } });
  if (!content) return res.status(404).json({ error: { message: "Content item was not found." } });
  if (content.platformPostId || !["PUBLISHING", "FAILED"].includes(content.status)) return res.status(409).json({ error: { message: "Only an unpublished item stuck in Publishing or Failed can be marked as not published." } });
  const data = await prisma.contentItem.update({ where: { id: content.id }, data: { status: "FAILED", scheduledAt: null } });
  await prisma.auditEvent.create({ data: { actor: req.adminUser?.email || "admin", action: "PUBLISH_STATE_RESOLVED_BY_HUMAN", entityType: "ContentItem", entityId: content.id, details: asJson({ outcome: "CONFIRMED_NOT_PUBLISHED_ON_FACEBOOK" }) } });
  return res.json({ data });
}));
workspaceRouter.get("/strategy/learning", asyncRoute(async (_req, res) => {
  const rows = await prisma.experiment.findMany({ take: 500, orderBy: { createdAt: "desc" }, select: { experimentKey: true, variant: true, contentItem: { select: { leads: { select: { status: true } }, metrics: { orderBy: { observedAt: "desc" }, take: 1, select: { uniqueMediaViews: true, views: true, reactions: true, comments: true, shares: true } } } } } });
  const groups = new Map<string, { experimentKey: string; variant: string; posts: number; qualified: number; booked: number; views: number }>();
  for (const row of rows) {
    const key = `${row.experimentKey}:${row.variant}`;
    const group = groups.get(key) ?? { experimentKey: row.experimentKey, variant: row.variant, posts: 0, qualified: 0, booked: 0, views: 0 };
    group.posts++;
    group.qualified += row.contentItem.leads.filter(lead => lead.status === "QUALIFIED" || lead.status === "BOOKED").length;
    group.booked += row.contentItem.leads.filter(lead => lead.status === "BOOKED").length;
    group.views += row.contentItem.metrics[0]?.uniqueMediaViews ?? row.contentItem.metrics[0]?.views ?? 0;
    groups.set(key, group);
  }
  return res.json({ data: [...groups.values()].sort((a, b) => a.experimentKey.localeCompare(b.experimentKey) || b.qualified - a.qualified), note: "Per-variant results from published posts. Treat small samples as exploration, not proof." });
}));

workspaceRouter.patch("/content/:id", asyncRoute(async (req, res) => {
  const schema = z.object({ status: z.enum(["IDEA", "DRAFT", "VALIDATED", "SCHEDULED", "PAUSED"]), scheduledAt: z.string().datetime().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid status or schedule time." } });
  const existing = await prisma.contentItem.findUnique({ where: { id: req.params.id }, select: { status: true, platformPostId: true } });
  if (!existing) return res.status(404).json({ error: { message: "Content item was not found." } });
  if (existing.platformPostId || ["PUBLISHING", "PUBLISHED"].includes(existing.status)) return res.status(409).json({ error: { message: "Published or in-flight content cannot be rescheduled or changed." } });
  if (parsed.data.status === "SCHEDULED" && (!parsed.data.scheduledAt || new Date(parsed.data.scheduledAt) <= new Date())) return res.status(400).json({ error: { message: "Choose a future date and time for a draft schedule." } });
  const data = await prisma.contentItem.update({ where: { id: req.params.id }, data: { status: parsed.data.status, scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : parsed.data.status === "PAUSED" || parsed.data.status === "SCHEDULED" ? undefined : null } });
  return res.json({ data, publishing: "available-when-live-mode-enabled" });
}));
workspaceRouter.patch("/content/:id/facebook-reference", asyncRoute(async (req, res) => {
  const parsed = z.object({ platformPostId: z.string().trim().min(3).max(200), publishedAt: z.string().datetime().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Provide the Facebook post ID after manually publishing the content." } });
  const data = await prisma.contentItem.update({ where: { id: req.params.id }, data: { platformPostId: parsed.data.platformPostId, status: "PUBLISHED", publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : new Date() } });
  await prisma.auditEvent.create({ data: { actor: req.adminUser?.email || "admin", action: "FACEBOOK_POST_LINKED", entityType: "ContentItem", entityId: data.id, details: asJson({ platformPostId: parsed.data.platformPostId, publishedAt: data.publishedAt, publishingMethod: "manual" }) } });
  return res.json({ data, note: "Reference saved for analytics only. This endpoint did not publish to Facebook." });
}));
workspaceRouter.delete("/content/:id", asyncRoute(async (req, res) => { await prisma.contentItem.delete({ where: { id: req.params.id } }); return res.status(204).end(); }));

workspaceRouter.get("/leads", asyncRoute(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const statuses = ["NEW", "QUALIFIED", "UNQUALIFIED", "CONTACTED", "BOOKED", "LOST"];
  const data = await prisma.lead.findMany({ where: status && statuses.includes(status) ? { status: status as never } : undefined, orderBy: { createdAt: "desc" }, take: 250, select: { id: true, contactName: true, contactChannel: true, status: true, qualificationReason: true, qualificationScore: true, serviceArea: true, classLevel: true, subjects: true, schedulePreference: true, budget: true, sourceContentId: true, attributionConfidence: true, notes: true, bookedAt: true, createdAt: true, updatedAt: true } });
  return res.json({ data });
}));
workspaceRouter.post("/leads", asyncRoute(async (req, res) => {
  const schema = z.object({ contactName: z.string().max(120).optional(), contactChannel: z.enum(["MESSENGER", "PHONE", "WHATSAPP", "OTHER"]).default("MESSENGER"), status: z.enum(["NEW", "QUALIFIED", "UNQUALIFIED", "CONTACTED", "BOOKED", "LOST"]).default("NEW"), qualificationReason: z.string().max(1000).optional(), serviceArea: z.string().max(180).optional(), classLevel: z.string().max(80).optional(), subjects: z.array(z.string().max(80)).max(20).optional(), schedulePreference: z.string().max(180).optional(), budget: z.string().max(100).optional(), sourceContentId: z.string().optional(), notes: z.string().max(1000).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Check the lead details and try again." } });
  const { subjects, ...rest } = parsed.data;
  const data = await prisma.lead.create({ data: { ...rest, subjects: subjects ? asJson(subjects) : undefined, bookedAt: rest.status === "BOOKED" ? new Date() : undefined } });
  await prisma.auditEvent.create({ data: { actor: req.adminUser?.email || "admin", action: "LEAD_CREATED", entityType: "Lead", entityId: data.id, details: asJson({ status: data.status }) } });
  return res.status(201).json({ data });
}));
workspaceRouter.patch("/leads/:id", asyncRoute(async (req, res) => {
  const schema = z.object({ status: z.enum(["NEW", "QUALIFIED", "UNQUALIFIED", "CONTACTED", "BOOKED", "LOST"]), qualificationReason: z.string().max(1000).optional(), serviceArea: z.string().max(180).optional(), classLevel: z.string().max(80).optional(), schedulePreference: z.string().max(180).optional(), budget: z.string().max(100).optional(), sourceContentId: z.string().nullable().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid lead update." } });
  const data = await prisma.lead.update({ where: { id: req.params.id }, data: { ...parsed.data, bookedAt: parsed.data.status === "BOOKED" ? new Date() : undefined } });
  await prisma.auditEvent.create({ data: { actor: req.adminUser?.email || "admin", action: "LEAD_UPDATED", entityType: "Lead", entityId: data.id, details: asJson({ status: data.status }) } });
  return res.json({ data });
}));

workspaceRouter.get("/strategy/experiments", asyncRoute(async (_req, res) => {
  const [experiments, snapshot, qualifiedLeads] = await Promise.all([
    prisma.campaignExperiment.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.pageSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } }),
    prisma.lead.count({ where: { status: "QUALIFIED" } }),
  ]);
  return res.json({ data: experiments, baselineAvailable: Boolean(snapshot), latestBaselineAt: snapshot?.fetchedAt ?? null, qualifiedLeadCount: qualifiedLeads, recommendation: snapshot ? "Review the latest Page snapshot and compare changes against qualified lead outcomes before changing cadence." : "No Page baseline exists yet. Connect the Facebook Page and import permitted insights before making cadence recommendations." });
}));
workspaceRouter.post("/strategy/experiments", asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().min(3).max(160), hypothesis: z.string().min(5).max(1000), variable: z.string().min(2).max(160) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Enter an experiment name, hypothesis, and one variable." } });
  const data = await prisma.campaignExperiment.create({ data: parsed.data });
  return res.status(201).json({ data });
}));
workspaceRouter.patch("/strategy/experiments/:id", asyncRoute(async (req, res) => {
  const parsed = z.object({ status: z.enum(["PLANNED", "RUNNING", "COMPLETED", "CANCELLED"]), result: z.record(z.string(), z.unknown()).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid experiment update." } });
  const data = await prisma.campaignExperiment.update({ where: { id: req.params.id }, data: { status: parsed.data.status, result: parsed.data.result ? asJson(parsed.data.result) : undefined, endAt: parsed.data.status === "COMPLETED" || parsed.data.status === "CANCELLED" ? new Date() : undefined, startAt: parsed.data.status === "RUNNING" ? new Date() : undefined } });
  return res.json({ data });
}));

workspaceRouter.get("/learning", asyncRoute(async (_req, res) => {
  const [decisions, experiments, audit] = await Promise.all([
    prisma.agentDecision.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.campaignExperiment.findMany({ orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.auditEvent.findMany({ where: { action: { in: ["CONTENT_DRAFT_GENERATED", "LEAD_CREATED", "LEAD_UPDATED", "SAFETY_SETTINGS_UPDATED"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, actor: true, action: true, entityType: true, entityId: true, details: true, createdAt: true } }),
  ]);
  return res.json({ decisions, experiments, audit });
}));
workspaceRouter.post("/learning/decisions", asyncRoute(async (req, res) => {
  const parsed = z.object({ category: z.string().min(2).max(80), observation: z.record(z.string(), z.unknown()), hypothesis: z.string().min(5).max(1000), confidence: z.number().min(0).max(1), action: z.record(z.string(), z.unknown()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Provide an observation, hypothesis, confidence, and proposed action." } });
  const data = await prisma.agentDecision.create({ data: { runId: `manual-${Date.now()}`, ...parsed.data, observation: asJson(parsed.data.observation), action: asJson(parsed.data.action) } });
  return res.status(201).json({ data });
}));

workspaceRouter.get("/overview", asyncRoute(async (_req, res) => {
  const [qualifiedLeads, bookings, recentSnapshot, drafts, scheduled, settings] = await Promise.all([
    prisma.lead.count({ where: { status: "QUALIFIED" } }), prisma.lead.count({ where: { status: "BOOKED" } }),
    prisma.pageSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } }), prisma.contentItem.count({ where: { status: { in: ["IDEA", "DRAFT", "VALIDATED"] } } }),
    prisma.contentItem.count({ where: { status: "SCHEDULED" } }), prisma.systemSetting.findMany({ where: { key: { in: ["globalAutomationPaused", "agentMode"] } } }),
  ]);
  const values = Object.fromEntries(settings.map(s => [s.key, s.value]));
  const paused = values.globalAutomationPaused !== false;
  const summary = recentSnapshot?.rawSummary as { page?: { name?: string }; coverage?: { postCount?: number; insightsAvailable?: number }; posts?: Array<{ insights?: Record<string, unknown> }> } | null;
  const numericMetric = (key: string) => { const values = (summary?.posts || []).map(post => post.insights?.[key]).map(value => typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null).filter((value): value is number => value !== null); return values.length ? values.reduce((sum, value) => sum + value, 0) : null; };
  return res.json({ qualifiedLeads, bookings, pageName: summary?.page?.name ?? null, postCount: summary?.coverage?.postCount ?? null, insightsAvailable: summary?.coverage?.insightsAvailable ?? null, totalUniqueMediaViews: numericMetric("post_total_media_view_unique"), totalViews: numericMetric("post_media_view"), lastAnalyzedAt: recentSnapshot?.fetchedAt ?? null, drafts, scheduled, globalAutomationPaused: paused, agentMode: !paused && values.agentMode === true, publishMode: env.META_PUBLISH_MODE });
}));
