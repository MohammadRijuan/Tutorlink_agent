import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { createBrandedAsset } from "./content/asset.service.js";
import { dataUrlToBuffer, svgToPng } from "./content/render.service.js";
import { messengerUrlFor } from "./meta/messenger-link.js";

/**
 * Public "link card" pages. A Facebook link post needs a URL whose Open Graph tags supply the picture/title shown on the post.
 * The URL points here; people who click the card are sent straight to Messenger with the per-post attribution tag.
 * Only content that is being (or has been) published is exposed, and ids are unguessable.
 */
export const shareRouter = Router();
shareRouter.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

const ID = /^[A-Za-z0-9_-]{10,64}$/;
const CRAWLER = /facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|twitterbot|whatsapp|telegrambot/i;
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const asyncRoute = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);

export function publicBaseUrl(): string {
  const configured = process.env.PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : "";
}

async function loadShareable(id: string) {
  if (!ID.test(id)) return null;
  const content = await prisma.contentItem.findUnique({ where: { id }, select: { id: true, title: true, subtitle: true, caption: true, status: true, linkAssetUrl: true, visualStyle: true, designPalette: true } });
  return content && ["PUBLISHING", "PUBLISHED"].includes(content.status) ? content : null;
}

shareRouter.get("/:id", asyncRoute(async (req, res) => {
  const content = await loadShareable(String(req.params.id));
  if (!content) return res.status(404).type("text/plain").send("Not found");
  const target = messengerUrlFor(content.id);
  if (!CRAWLER.test(String(req.headers["user-agent"] || ""))) return res.redirect(302, target); // people go straight to Messenger
  const base = publicBaseUrl() || `${req.protocol}://${req.get("host")}`;
  const description = (content.subtitle || content.caption.split("\n").find((line: string) => line.trim().length > 20) || "").slice(0, 200);
  res.set("Cache-Control", "public, max-age=300").type("html").send(`<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>${escapeHtml(content.title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="TutorLink Tuition Media">
<meta property="og:title" content="${escapeHtml(content.title)}"><meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(`${base}/s/${content.id}`)}"><meta property="og:image" content="${escapeHtml(`${base}/s/${content.id}/image.png`)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"></head>
<body><a href="${escapeHtml(target)}">মেসেঞ্জারে যোগাযোগ করুন</a></body></html>`);
}));

shareRouter.get("/:id/image.png", asyncRoute(async (req, res) => {
  const content = await loadShareable(String(req.params.id));
  if (!content) return res.status(404).type("text/plain").send("Not found");
  const source = content.linkAssetUrl ? dataUrlToBuffer(content.linkAssetUrl) : null;
  const svg = source ?? dataUrlToBuffer(await createBrandedAsset({ title: content.title, subtitle: content.subtitle, format: "LINK", visualStyle: (content.visualStyle as never) || undefined, palette: content.designPalette }))!;
  const png = await svgToPng(svg);
  res.set({ "Cache-Control": "public, max-age=86400, immutable", "Cross-Origin-Resource-Policy": "cross-origin" }).type("png").send(png);
}));
