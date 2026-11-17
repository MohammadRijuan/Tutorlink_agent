import { prisma } from "../../lib/prisma.js";
import { svgToPng } from "../content/render.service.js";
import { CREATIVE_FONT_FAMILY, sanitizeForCreative } from "../../lib/fonts.js";

export type Brand = { pageName: string; logo: Buffer };
const cache = new Map<string, Buffer>();

async function circleCrop(input: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><circle cx="160" cy="160" r="160" fill="#fff"/></svg>');
  return sharp(input).resize(320, 320, { fit: "cover" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}
async function letterLogo(): Promise<Buffer> {
  return svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><circle cx="160" cy="160" r="160" fill="#f4b942"/><text x="160" y="205" text-anchor="middle" font-family="${CREATIVE_FONT_FAMILY}" font-size="150" font-weight="800" fill="#0b2440">T</text></svg>`);
}

/** The Page's own name and profile picture (from the latest Page snapshot). Falls back to a clean "T" mark if the picture cannot be fetched. */
export async function loadBrand(): Promise<Brand> {
  const snapshot = await prisma.pageSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { pageName: true, profilePicture: true } }).catch(() => null);
  const pageName = sanitizeForCreative(snapshot?.pageName || "TutorLink Tuition Media") || "TutorLink Tuition Media";
  const url = snapshot?.profilePicture;
  if (url && /^https:\/\//i.test(url)) {
    const cached = cache.get(url);
    if (cached) return { pageName, logo: cached };
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host === "facebook.com" || host.endsWith(".facebook.com") || host.endsWith(".fbcdn.net") || host.endsWith(".fbsbx.com")) {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const bytes = Buffer.from(await response.arrayBuffer());
        if (response.ok && /^image\//.test(response.headers.get("content-type") || "") && bytes.length < 1_500_000) {
          const logo = await circleCrop(bytes);
          if (cache.size > 4) cache.clear();
          cache.set(url, logo);
          return { pageName, logo };
        }
      }
    } catch { /* use the fallback mark */ }
  }
  return { pageName, logo: await letterLogo() };
}
