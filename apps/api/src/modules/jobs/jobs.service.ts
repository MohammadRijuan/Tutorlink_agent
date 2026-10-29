import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { classifyFailure, OperationError } from "../../lib/retry.js";
import { buildCreativeForDraft } from "../content/creative.service.js";
import { assertAiBudget } from "../ai/ai.service.js";
import { CREATIVE_ANGLES, VISUAL_STYLES, generateDraft, type GenerateInput } from "../content/content.service.js";

const CONTENT_JOB = "CONTENT_GENERATION";
const payloadSchema = z.object({
  input: z.object({
    topic: z.string().trim().min(3).max(180),
    format: z.enum(["POST", "REEL"]),
    audience: z.string().max(180).optional(),
    goal: z.string().max(180).optional(),
    guidance: z.string().max(1800).optional(),
    creativeAngle: z.enum(CREATIVE_ANGLES).optional(),
    visualStyle: z.enum(VISUAL_STYLES).optional(),
  }),
  actorId: z.string().min(1),
  automatic: z.boolean().optional(),
});
const draftSchema = z.object({
  title: z.string().min(1).max(180),
  caption: z.string().min(1).max(10000),
  hashtags: z.array(z.string().max(80)).max(10),
  script: z.string().max(10000).nullable(),
  subtitle: z.string().max(300).nullable().optional(),
  reelScenes: z.array(z.string().max(200)).max(6).nullable().optional(),
  model: z.string().max(180),
  provider: z.string().max(40),
  fallbackFrom: z.string().max(180).optional(),
  warning: z.string().max(300).optional(),
});

type Claim = {
  id: string;
  payload: Prisma.JsonValue;
  attemptCount: number;
  maxAttempts: number;
  result: Prisma.JsonValue | null;
};

class AutomationPausedError extends Error {}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function durableJobSchemaAvailable() {
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'JobRun'
      AND column_name IN ('payload', 'attemptCount', 'maxAttempts', 'nextAttemptAt', 'leaseExpiresAt', 'lastErrorCategory', 'createdAt', 'updatedAt', 'completedAt')
  `;
  return columns.length === 9;
}

export async function enqueueContentGeneration(input: GenerateInput, actorId: string, requestKey: string, automatic = false) {
  const idempotencyKey = `content:${actorId}:${requestKey}`;
  try {
    const job = await prisma.jobRun.create({
      data: {
        jobKey: CONTENT_JOB,
        idempotencyKey,
        status: "PENDING",
        payload: toJson({ input, actorId, automatic }),
        maxAttempts: env.JOB_MAX_ATTEMPTS,
        nextAttemptAt: new Date(),
      },
      select: { id: true, status: true, attemptCount: true, maxAttempts: true, nextAttemptAt: true, createdAt: true },
    });
    console.info(JSON.stringify({ event: "job_enqueued", jobId: job.id, jobType: CONTENT_JOB, automatic, maxAttempts: job.maxAttempts }));
    return { job, duplicate: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.jobRun.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true, attemptCount: true, maxAttempts: true, nextAttemptAt: true, createdAt: true },
    });
    if (!existing) throw error;
    return { job: existing, duplicate: true };
  }
}

export async function listContentJobs(take = 20) {
  return prisma.jobRun.findMany({
    where: { jobKey: CONTENT_JOB },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true, jobKey: true, status: true, attemptCount: true, maxAttempts: true,
      nextAttemptAt: true, lastErrorCategory: true, errorCode: true, errorMessage: true,
      result: true, createdAt: true, updatedAt: true, completedAt: true,
    },
  });
}

export async function getContentJob(id: string) {
  return prisma.jobRun.findFirst({
    where: { id, jobKey: CONTENT_JOB },
    select: {
      id: true, jobKey: true, status: true, attemptCount: true, maxAttempts: true,
      nextAttemptAt: true, lastErrorCategory: true, errorCode: true, errorMessage: true,
      result: true, createdAt: true, updatedAt: true, completedAt: true,
    },
  });
}

export async function requestContentJobRetry(id: string) {
  const retryableCategories = ["RATE_LIMITED", "PROVIDER_UNAVAILABLE", "NETWORK_ERROR", "TIMEOUT", "OUTPUT_INVALID", "WORKER_INTERRUPTED"];
  const changed = await prisma.jobRun.updateMany({
    where: { id, jobKey: CONTENT_JOB, status: "FAILED", lastErrorCategory: { in: retryableCategories } },
    data: { status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), leaseExpiresAt: null, finishedAt: null, completedAt: null, errorCode: null, errorMessage: null, lastErrorCategory: null },
  });
  if (changed.count === 1) return getContentJob(id);
  return null;
}

async function recoverExpiredClaims() {
  const now = new Date();
  const expired = await prisma.jobRun.findMany({
    where: { jobKey: CONTENT_JOB, status: "PROCESSING", leaseExpiresAt: { lte: now } },
    select: { id: true, attemptCount: true, maxAttempts: true },
    take: 20,
  });
  for (const job of expired) {
    const exhausted = job.attemptCount >= job.maxAttempts;
    await prisma.jobRun.updateMany({
      where: { id: job.id, status: "PROCESSING", leaseExpiresAt: { lte: now } },
      data: {
        status: exhausted ? "FAILED" : "RETRY_WAIT",
        lastErrorCategory: "WORKER_INTERRUPTED",
        errorCode: "WORKER_INTERRUPTED",
        errorMessage: "A worker stopped before completing this job. It will resume automatically when eligible.",
        nextAttemptAt: now,
        leaseExpiresAt: null,
        finishedAt: exhausted ? now : null,
        completedAt: null,
        updatedAt: now,
      },
    });
  }
  return expired.length;
}

async function claimNextJob(): Promise<Claim | null> {
  const claims = await prisma.$queryRaw<Claim[]>`
    UPDATE "JobRun"
    SET "status" = 'PROCESSING',
        "attemptCount" = "attemptCount" + 1,
        "startedAt" = NOW(),
        "leaseExpiresAt" = NOW() + (${env.JOB_LEASE_MS} * INTERVAL '1 millisecond'),
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id"
      FROM "JobRun"
      WHERE "jobKey" = ${CONTENT_JOB}
        AND "status" IN ('PENDING', 'RETRY_WAIT')
        AND "nextAttemptAt" <= NOW()
        AND (
          COALESCE("payload" ->> 'automatic', 'false') <> 'true'
          OR (
            COALESCE((SELECT "value" FROM "SystemSetting" WHERE "key" = 'globalAutomationPaused'), 'true'::jsonb) = 'false'::jsonb
            AND COALESCE((SELECT "value" FROM "SystemSetting" WHERE "key" = 'agentMode'), 'false'::jsonb) = 'true'::jsonb
          )
        )
      ORDER BY "nextAttemptAt", "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "payload", "attemptCount", "maxAttempts", "result"
  `;
  return claims[0] ?? null;
}

function recoverableDelay(attempt: number) {
  const ceiling = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));
  return Math.floor(ceiling * (0.5 + Math.random() * 0.5));
}

function requiresAttention(category: string) {
  return ["CONFIGURATION", "AUTHENTICATION", "QUOTA_EXHAUSTED", "PERMISSION_DENIED", "VALIDATION"].includes(category);
}

async function automationEnabled() {
  const settings = await prisma.systemSetting.findMany({ where: { key: { in: ["globalAutomationPaused", "agentMode"] } } });
  const values = Object.fromEntries(settings.map(setting => [setting.key, setting.value]));
  return values.globalAutomationPaused === false && values.agentMode === true;
}

async function deferForHumanTakeover(job: Claim) {
  await prisma.jobRun.updateMany({
    where: { id: job.id, status: "PROCESSING", attemptCount: job.attemptCount },
    data: { status: "PENDING", attemptCount: Math.max(0, job.attemptCount - 1), nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000), leaseExpiresAt: null, updatedAt: new Date() },
  });
  return "paused";
}

async function persistFailure(job: Claim, error: unknown) {
  const failure = classifyFailure(error);
  const retry = failure.retryable && job.attemptCount < job.maxAttempts;
  const needsAttention = requiresAttention(failure.category);
  const now = new Date();
  const waitMs = failure.retryAfterMs ?? recoverableDelay(job.attemptCount);
  const updated = await prisma.jobRun.updateMany({
    where: { id: job.id, status: "PROCESSING", attemptCount: job.attemptCount },
    data: {
      status: retry ? "RETRY_WAIT" : needsAttention ? "NEEDS_ATTENTION" : "FAILED",
      nextAttemptAt: new Date(now.getTime() + waitMs),
      leaseExpiresAt: null,
      lastErrorCategory: failure.category,
      errorCode: failure.category,
      errorMessage: failure.message.slice(0, 500),
      finishedAt: retry ? null : now,
      completedAt: null,
      updatedAt: now,
    },
  });
  if (updated.count === 1) {
    console.warn(JSON.stringify({ event: "job_attempt_failed", jobId: job.id, attempt: job.attemptCount, category: failure.category, retryScheduled: retry, nextAttemptAt: retry ? new Date(now.getTime() + waitMs).toISOString() : null }));
  }
}

async function runClaimedJob(job: Claim) {
  const parsedPayload = payloadSchema.safeParse(job.payload);
  if (!parsedPayload.success) {
    await persistFailure(job, new OperationError("Stored job payload is invalid. Create a new job with valid content details.", "VALIDATION", false));
    return "failed";
  }
  const { input, actorId, automatic = false } = parsedPayload.data;
  if (automatic && !(await automationEnabled())) return deferForHumanTakeover(job);
  const stored = job.result && typeof job.result === "object" && "draft" in job.result ? draftSchema.safeParse(job.result.draft) : null;
  let draft = stored?.success ? stored.data : null;

  if (!draft) {
    try { await assertAiBudget(); }
    catch (error) { await persistFailure(job, error); return "needs_attention"; }
    const recentDrafts = await prisma.contentItem.findMany({
      orderBy: { createdAt: "desc" }, take: 40,
      select: { title: true, topic: true, format: true, caption: true, creativeAngle: true },
    });
    const generated = await generateDraft({ ...input, avoidRecent: recentDrafts }, { maxAttempts: 1 });
    draft = draftSchema.parse(generated);
    if (automatic && !(await automationEnabled())) {
      await prisma.jobRun.updateMany({
        where: { id: job.id, status: "PROCESSING", attemptCount: job.attemptCount },
        data: { result: toJson({ draft }), updatedAt: new Date() },
      });
      return deferForHumanTakeover(job);
    }
    const savedDraft = await prisma.jobRun.updateMany({
      where: { id: job.id, status: "PROCESSING", attemptCount: job.attemptCount },
      data: { result: toJson({ draft }), updatedAt: new Date() },
    });
    if (savedDraft.count !== 1) return "claim_lost";
  }

  if (automatic && !(await automationEnabled())) return deferForHumanTakeover(job);
  const { visualStyle, designPalette, assetUrl, linkAssetUrl } = await buildCreativeForDraft({ title: draft.title, subtitle: draft.subtitle, caption: draft.caption, format: input.format, requestedStyle: input.visualStyle });
  await prisma.$transaction(async (tx) => {
    if (automatic) {
      const safety = await tx.$queryRaw<Array<{ key: string; value: unknown }>>`
        SELECT "key", "value"
        FROM "SystemSetting"
        WHERE "key" IN ('globalAutomationPaused', 'agentMode')
        FOR SHARE
      `;
      const values = Object.fromEntries(safety.map(setting => [setting.key, setting.value]));
      if (values.globalAutomationPaused !== false || values.agentMode !== true) throw new AutomationPausedError();
    }
    const content = await tx.contentItem.create({
      data: {
        title: draft.title,
        format: input.format,
        topic: input.topic,
        creativeAngle: input.creativeAngle || "AUTO",
        visualStyle,
        language: "bn",
        caption: draft.caption,
        hashtags: toJson(draft.hashtags),
        callToAction: "মেসেঞ্জারে যোগাযোগ করুন",
        script: draft.script,
        reelScenes: draft.reelScenes ? toJson(draft.reelScenes) : undefined,
        subtitle: draft.subtitle, designPalette, linkAssetUrl,
        assetUrl,
        status: "DRAFT",
      },
    });
    const completed = await tx.jobRun.updateMany({
      where: { id: job.id, status: "PROCESSING", attemptCount: job.attemptCount },
      data: {
        status: "COMPLETED",
        result: toJson({ contentId: content.id, provider: draft.provider, model: draft.model, fallbackFrom: draft.fallbackFrom, creativeAngle: input.creativeAngle || "AUTO", visualStyle }),
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        lastErrorCategory: null,
        finishedAt: new Date(),
        completedAt: new Date(),
      },
    });
    if (completed.count !== 1) throw new OperationError("This worker no longer owns the job lease.", "WORKER_INTERRUPTED", true);
    await tx.auditEvent.create({
      data: {
        actor: actorId,
        action: "CONTENT_DRAFT_GENERATED",
        entityType: "ContentItem",
        entityId: content.id,
        details: toJson({ jobId: job.id, provider: draft.provider, model: draft.model, fallbackFrom: draft.fallbackFrom, format: input.format, creativeAngle: input.creativeAngle || "AUTO", visualStyle, published: false }),
      },
    });
  });
  console.info(JSON.stringify({ event: "job_completed", jobId: job.id, jobType: CONTENT_JOB, attempt: job.attemptCount, provider: draft.provider, model: draft.model }));
  return "completed";
}

export async function processDueContentJobs(limit = env.JOB_BATCH_SIZE) {
  if (!(await durableJobSchemaAvailable())) {
    return { durableQueueEnabled: false, recovered: 0, processed: 0, backlog: 0, outcomes: [] };
  }
  const recovered = await recoverExpiredClaims();
  const outcomes: Array<{ jobId: string; status: string }> = [];
  for (let index = 0; index < Math.min(limit, env.JOB_BATCH_SIZE); index++) {
    const job = await claimNextJob();
    if (!job) break;
    try {
      outcomes.push({ jobId: job.id, status: await runClaimedJob(job) });
    } catch (error) {
      if (error instanceof AutomationPausedError) {
        outcomes.push({ jobId: job.id, status: await deferForHumanTakeover(job) });
      } else {
        await persistFailure(job, error);
        outcomes.push({ jobId: job.id, status: "retry_or_failure_recorded" });
      }
    }
  }
  const backlog = await prisma.jobRun.count({ where: { jobKey: CONTENT_JOB, status: { in: ["PENDING", "PROCESSING", "RETRY_WAIT"] } } });
  return { durableQueueEnabled: true, recovered, processed: outcomes.length, backlog, outcomes };
}
