import type { Request, Response } from "express";
import { spawn } from "node:child_process";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { ffmpegBinary } from "../lib/ffmpeg.js";
import { findUnsupportedCharacters, resolveFontsDir } from "../lib/fonts.js";
import { configuredChain, getAiUsage } from "../modules/ai/ai.service.js";
import { getAutomationState } from "../modules/agent-control.service.js";
import { svgToPng } from "../modules/content/render.service.js";
import { messengerBaseUrl } from "../modules/meta/messenger-link.js";

export function getHealth(_req: Request, res: Response) {
  return res.status(200).json({ status: "ok", service: "tutorlink-ai-marketing-manager-api", timestamp: new Date().toISOString() });
}

export async function getSystemStatus(_req: Request, res: Response) {
  const state = await getAutomationState();
  const chain = configuredChain("content");
  return res.json({
    product: "TutorLink AI Marketing Manager",
    northStarMetric: "qualified_organic_tuition_leads",
    publishing: env.META_PUBLISH_MODE === "live" ? "live-mode" : "dry-run",
    configuredPublishMode: env.META_PUBLISH_MODE,
    automationPaused: state.paused,
    agentMode: !state.paused && state.agentMode,
    integrations: {
      metaConfigured: Boolean(env.META_PAGE_ID && env.META_PAGE_ACCESS_TOKEN),
      messengerConfigured: Boolean(env.META_MESSENGER_URL),
      aiProvider: env.AI_PROVIDER,
      aiModel: env.AI_PROVIDER === "template" ? "template" : chain[0] ? `${chain[0].provider}:${chain[0].model}` : "none",
      aiConfigured: env.AI_PROVIDER === "template" || chain.length > 0,
    },
  });
}

type Check = { id: string; label: string; ok: boolean; detail?: string };

function ffmpegVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), ["-version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("timed out")); }, 8000);
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); code === 0 ? resolve(out.split("\n")[0] ?? "ffmpeg") : reject(new Error(`exit ${code}`)); });
  });
}

/** One-click deployment self-check: proves the pieces that fail silently on serverless (database schema, fonts, ffmpeg, credentials). */
export async function getDiagnostics(_req: Request, res: Response) {
  const checks: Check[] = [];
  const run = async (id: string, label: string, fn: () => Promise<string | void>) => {
    try { const detail = await fn(); checks.push({ id, label, ok: true, ...(detail ? { detail } : {}) }); }
    catch (error) { checks.push({ id, label, ok: false, detail: (error instanceof Error ? error.message : "failed").slice(0, 240) }); }
  };
  await run("database", "Database reachable", async () => { await prisma.$queryRaw`SELECT 1`; });
  await run("schema", "Database schema is up to date", async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name::text AS column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ContentItem' AND column_name = 'linkAssetUrl'`;
    if (rows.length !== 1) throw new Error("Latest migration is missing. Run: npm run db:deploy");
  });
  await run("fonts", "Bangla fonts render correctly", async () => {
    resolveFontsDir();
    const missing = findUnsupportedCharacters("হোম টিউটর ০১৮৮৬-৬০৩৮৫৮ 01886-603858 #TutorlinkTuitionMedia");
    if (missing.length) throw new Error(`Font lacks glyphs: ${missing.join(" ")}`);
    const png = await svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80"><rect width="100%" height="100%" fill="#fff"/><text x="10" y="55" font-family="Noto Sans Bengali" font-size="40" fill="#000">হোম টিউটর</text></svg>`);
    if (png.length < 800) throw new Error("Rendered image is unexpectedly empty");
  });
  await run("ffmpeg", "FFmpeg available for Reels", async () => ffmpegVersion());
  await run("messenger", "Messenger URL configured", async () => { messengerBaseUrl(); });
  checks.push({ id: "meta", label: "Facebook Page ID and token set", ok: Boolean(env.META_PAGE_ID && env.META_PAGE_ACCESS_TOKEN) });
  checks.push({ id: "webhook", label: "Webhook secrets set (META_APP_SECRET, META_VERIFY_TOKEN)", ok: Boolean(env.META_APP_SECRET && env.META_VERIFY_TOKEN) });
  checks.push({ id: "ai", label: "At least one free AI provider key is set", ok: env.AI_PROVIDER === "template" || configuredChain("content").length > 0 });
  checks.push({ id: "mode", label: `Publish mode: ${env.META_PUBLISH_MODE}`, ok: true, detail: env.META_PUBLISH_MODE === "live" ? "Live: the agent can publish to Facebook." : "Dry-run: nothing is published." });
  return res.json({ ok: checks.every(check => check.ok), checks, aiUsage: await getAiUsage().catch(() => null) });
}
