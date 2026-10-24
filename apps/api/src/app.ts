import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { systemRouter } from "./routes/system.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { requireAdmin, requireAuth } from "./modules/auth/auth.middleware.js";
import { workspaceRouter } from "./modules/workspace.routes.js";
import { generateScheduledDraft } from "./modules/content/automation.service.js";
import { runPerformanceMonitor } from "./modules/performance.service.js";
import { processDueContentJobs } from "./modules/jobs/jobs.service.js";
import { timingSafeEqual } from "node:crypto";
import { classifyFailure } from "./lib/retry.js";
import { ingestMetaWebhook } from "./modules/meta/webhook.service.js";
import { verifyMetaSignature, verifyMetaWebhookSubscription } from "./modules/meta/webhook-security.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Vercel terminates TLS in front of the function; needed for correct client IPs and rate limiting
  app.use(helmet());
  app.use(cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }));
  app.use(express.json({ limit: "1mb", verify: (req, _res, buffer) => { (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
  app.use(pinoHttp({
    redact: ["req.headers.authorization", "req.headers.cookie"],
    serializers: { req(req) { return { method: req.method, url: req.url }; } },
  }));

  // Meta webhook: signature verification is performed against the exact raw request body.
  app.get("/api/meta/webhook", (req, res) => {
    const challenge = verifyMetaWebhookSubscription(String(req.query["hub.mode"] || ""), String(req.query["hub.verify_token"] || ""), String(req.query["hub.challenge"] || ""));
    if (!challenge) return res.status(403).send("Webhook verification failed.");
    return res.status(200).type("text/plain").send(challenge);
  });
  app.post("/api/meta/webhook", async (req, res) => {
    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody || !verifyMetaSignature(rawBody, req.header("x-hub-signature-256"))) return res.status(401).json({ error: { message: "Invalid Meta webhook signature." } });
    try {
      const result = await ingestMetaWebhook(req.body);
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      const failure = classifyFailure(error);
      console.error(JSON.stringify({ event: "meta_webhook_ingest_failed", category: failure.category }));
      return res.status(500).json({ error: { message: "Webhook event was not fully processed. Meta may retry this delivery." } });
    }
  });

  // Vercel Cron uses GET + Authorization: Bearer <CRON_SECRET>. This route runs the protected autonomous campaign when live publishing is enabled.
  app.get("/api/cron/content-generation", async (req, res) => {
    const supplied = req.header("authorization") || "";
    const expected = `Bearer ${env.CRON_SECRET}`;
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: { message: "Unauthorized cron request." } });
    try {
      const result = await generateScheduledDraft();
      const worker = await processDueContentJobs();
      return res.status(200).json({ ok: true, campaign: result, worker, publishing: env.META_PUBLISH_MODE === "live" ? "live-mode" : "dry-run" });
    } catch (error) {
      const failure = classifyFailure(error);
      console.error(JSON.stringify({ event: "campaign_cron_failed", category: failure.category, message: failure.message.slice(0, 400) }));
      return res.status(500).json({ error: { code: failure.category, message: "Scheduled campaign or the daily worker failed. See the audit log and Vercel function logs." } });
    }
  });

  app.get("/api/cron/performance-monitor", async (req, res) => {
    const supplied = Buffer.from(req.header("authorization") || "");
    const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ error: { message: "Unauthorized cron request." } });
    try {
      const result = await runPerformanceMonitor();
      return res.status(200).json({ ok: true, data: result });
    } catch (error) {
      const failure = classifyFailure(error);
      console.error(JSON.stringify({ event: "performance_monitor_failed", category: failure.category, message: failure.message }));
      return res.status(502).json({ error: { message: "Performance monitoring failed. Check Meta permissions and API logs." } });
    }
  });

  app.get("/api/cron/content-jobs", async (req, res) => {
    const supplied = Buffer.from(req.header("authorization") || "");
    const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(401).json({ error: { message: "Unauthorized cron request." } });
    }
    try {
      const result = await processDueContentJobs();
      return res.status(200).json({ ok: true, ...result, publishing: "disabled" });
    } catch (error) {
      const failure = classifyFailure(error);
      console.error(JSON.stringify({ event: "job_worker_failed", category: failure.category, message: failure.message }));
      return res.status(500).json({ error: { message: "The content job worker failed. Due jobs remain available for the next scheduled run." } });
    }
  });

  // Public liveness endpoint; all other versioned system routes require a valid admin JWT.
  app.get("/health", (_req, res) => res.status(200).json({ status: "ok", service: "tutorlink-ai-marketing-manager-api" }));
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", requireAuth, requireAdmin, systemRouter);
  app.use("/api/v1", requireAuth, requireAdmin, workspaceRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const code = typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : undefined;
    const name = err instanceof Error ? err.name : "UnknownError";
    console.error(JSON.stringify({ event: "unhandled_request_error", name, code }));
    if (code === "P2022" || code === "P2021") {
      return res.status(503).json({ error: { code: "DATABASE_SCHEMA_OUTDATED", message: "This operation needs a database migration that has not been applied. Review the migration history before retrying." } });
    }
    if (["P1001", "P1002", "P1008", "P1017"].includes(code || "")) {
      return res.status(503).json({ error: { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable. Please retry shortly." } });
    }
    const status = typeof err === "object" && err !== null && "status" in err && typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 500;
    const message = status < 500 && err instanceof Error ? err.message : "The request could not be completed. Check API logs for the error reference.";
    res.status(status).json({ error: { code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED", message } });
  });
  return app;
}
