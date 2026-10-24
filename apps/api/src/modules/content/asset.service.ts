import { createHash } from "node:crypto";
import type { ResolvedVisualStyle, VisualStyle } from "./content.service.js";
import { CREATIVE_FONT_FAMILY, sanitizeForCreative } from "../../lib/fonts.js";
import { layoutLines } from "./creative.text.js";

const FONT = CREATIVE_FONT_FAMILY;

const PHONE = "01886-603858";
const CTA = "মেসেঞ্জারে যোগাযোগ করুন";
const REQUIRED_HASHTAG = "#TutorlinkTuitionMedia";
const STYLE_ROTATION: ResolvedVisualStyle[] = ["BOLD_HOOK", "CHECKLIST", "SPLIT_LAYOUT", "MINIMAL", "EDITORIAL", "WARM"];

const PALETTES: Record<ResolvedVisualStyle, { start: string; end: string; accent: string; foreground: string; accentText: string; soft: string }> = {
  BOLD_HOOK: { start: "#0b2440", end: "#176b70", accent: "#f4b942", foreground: "#ffffff", accentText: "#102b46", soft: "#ffffff" },
  CHECKLIST: { start: "#fff8e8", end: "#f3efe4", accent: "#176b70", foreground: "#102b46", accentText: "#ffffff", soft: "#ffffff" },
  SPLIT_LAYOUT: { start: "#102b46", end: "#174e62", accent: "#f4b942", foreground: "#ffffff", accentText: "#102b46", soft: "#ffffff" },
  MINIMAL: { start: "#f8fafc", end: "#e8eef2", accent: "#d39b20", foreground: "#142d43", accentText: "#142d43", soft: "#ffffff" },
  EDITORIAL: { start: "#241746", end: "#56378a", accent: "#f6c85f", foreground: "#ffffff", accentText: "#241746", soft: "#ffffff" },
  WARM: { start: "#3b2020", end: "#8b4938", accent: "#ffd2a6", foreground: "#fff8ef", accentText: "#3b2020", soft: "#fff8ef" },
};

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Stable resolver for explicit styles; AUTO rotates by unique generation seed. */
export function resolveVisualStyle(requested: VisualStyle | undefined, seed: string, avoidRecent: string[] = []): ResolvedVisualStyle {
  if (requested && requested !== "AUTO") return requested;
  const digest = createHash("sha256").update(seed || "tutorlink").digest();
  const start = digest.readUInt32BE(0) % STYLE_ROTATION.length;
  for (let offset = 0; offset < STYLE_ROTATION.length; offset++) {
    const candidate = STYLE_ROTATION[(start + offset) % STYLE_ROTATION.length];
    if (candidate && !avoidRecent.slice(0, STYLE_ROTATION.length - 1).includes(candidate)) return candidate;
  }
  return STYLE_ROTATION[start] || "BOLD_HOOK";
}

async function embedProfilePicture(url?: string | null) {
  if (!url || !/^https:\/\//i.test(url)) return "";
  try { const host = new URL(url).hostname.toLowerCase(); if (!(host === "facebook.com" || host.endsWith(".facebook.com") || host.endsWith(".fbcdn.net") || host.endsWith(".fbsbx.com"))) return ""; } catch { return ""; }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = response.headers.get("content-type") || "";
    const length = Number(response.headers.get("content-length") || 0);
    if (!response.ok || !/^image\/(png|jpeg|webp)$/i.test(type) || (length && length > 1_000_000)) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 1_000_000) return "";
    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch { return ""; }
}

/** Creates a self-contained SVG post banner / Reel cover with six genuinely different visual templates. */
export async function createBrandedAsset(input: {
  title: string;
  pageName?: string | null;
  profilePicture?: string | null;
  format: "POST" | "REEL";
  visualStyle?: ResolvedVisualStyle;
}) {
  const style = input.visualStyle || "BOLD_HOOK";
  const palette = PALETTES[style];
  const pageName = xml(sanitizeForCreative(input.pageName || "TutorLink Tuition Media").slice(0, 70) || "TutorLink Tuition Media");
  const isReel = input.format === "REEL";
  const isSplit = style === "SPLIT_LAYOUT";
  const layout = await layoutLines(input.title, {
    maxWidth: isReel ? (isSplit ? 760 : 880) : (isSplit ? 860 : 960),
    sizes: isReel ? [68, 60, 54, 48] : [60, 54, 48, 42],
    maxLines: isReel ? 4 : 3,
  });
  const lines = layout.lines;
  const dimensions = input.format === "REEL" ? { width: 1080, height: 1920 } : { width: 1200, height: 1200 };
  const { width, height } = dimensions;
  const split = style === "SPLIT_LAYOUT";
  const minimal = style === "MINIMAL";
  const checklist = style === "CHECKLIST";
  const editorial = style === "EDITORIAL";
  const centerX = split ? 175 : width / 2;
  const anchor = split ? "start" : "middle";
  const lineHeight = Math.round(layout.fontSize * 1.3);
  const titleFont = layout.fontSize;
  // Centre the headline block in the free space between the page name and the phone pill, whatever the line count.
  const blockH = lines.length * lineHeight;
  const regionTop = isReel ? 340 : 300;
  const regionBottom = isReel ? 1040 : 630;
  const blockTop = Math.round(regionTop + (regionBottom - regionTop - blockH) / 2);
  const titleY = blockTop + Math.round(titleFont * 0.92);
  const phoneY = input.format === "REEL" ? 1160 : 760;
  const ctaY = input.format === "REEL" ? 1390 : 900;
  const hashtagY = input.format === "REEL" ? 1550 : 1040;
  const safePicture = xml(await embedProfilePicture(input.profilePicture));
  const logoX = split ? 142 : width / 2;
  const logo = safePicture
    ? `<image href="${safePicture}" x="${logoX - 58}" y="${input.format === "REEL" ? 90 : 72}" width="116" height="116" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar)"/>`
    : `<circle cx="${logoX}" cy="${input.format === "REEL" ? 148 : 130}" r="58" fill="${palette.accent}"/><text x="${logoX}" y="${input.format === "REEL" ? 169 : 151}" text-anchor="middle" font-family="${FONT}" font-size="52" font-weight="800" fill="${palette.accentText}">T</text>`;
  const pageTextX = split ? 218 : width / 2;
  const pageAnchor = split ? "start" : "middle";
  const titleSvg = lines.map((line, index) => `<tspan x="${centerX}" dy="${index === 0 ? 0 : lineHeight}">${xml(line)}</tspan>`).join("");
  const frame = minimal
    ? `<rect x="42" y="42" width="${width - 84}" height="${height - 84}" rx="18" fill="none" stroke="${palette.soft}" stroke-opacity=".35" stroke-width="3"/><path d="M90 ${blockTop - 60} H${width - 90}" stroke="${palette.accent}" stroke-width="10" stroke-linecap="round"/>`
    : checklist
      ? `<rect x="50" y="50" width="${width - 100}" height="${height - 100}" rx="40" fill="#ffffff" fill-opacity=".52" stroke="${palette.soft}" stroke-opacity=".18" stroke-width="3"/><circle cx="${width - 130}" cy="${blockTop - 70}" r="42" fill="${palette.accent}"/><path d="M${width - 150} ${blockTop - 70} l14 15 l29 -33" fill="none" stroke="${palette.accentText}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`
      : split
        ? `<path d="M0 0 H${Math.round(width * .24)} V${height} H0 Z" fill="${palette.accent}" fill-opacity=".18"/><rect x="60" y="60" width="${width - 120}" height="${height - 120}" rx="26" fill="none" stroke="${palette.soft}" stroke-opacity=".22" stroke-width="3"/><path d="M140 ${blockTop - 10} V${blockTop + blockH + 10}" stroke="${palette.accent}" stroke-width="9" stroke-linecap="round"/>`
        : editorial
          ? `<circle cx="${width - 80}" cy="${input.format === "REEL" ? 430 : 390}" r="${input.format === "REEL" ? 250 : 185}" fill="${palette.accent}" fill-opacity=".13"/><circle cx="80" cy="${height - 80}" r="${width * .28}" fill="${palette.accent}" fill-opacity=".10"/><text x="${width - 115}" y="${input.format === "REEL" ? 300 : 232}" text-anchor="middle" font-family="${FONT}" font-size="${input.format === "REEL" ? 150 : 110}" font-weight="900" fill="${palette.accent}" fill-opacity=".45">01</text>`
          : style === "WARM"
            ? `<path d="M0 ${height * .72} Q${width * .45} ${height * .52} ${width} ${height * .74} V${height} H0 Z" fill="${palette.accent}" fill-opacity=".12"/><circle cx="${width - 40}" cy="100" r="${width * .22}" fill="${palette.accent}" fill-opacity=".11"/>`
            : `<circle cx="${width}" cy="0" r="${width * .44}" fill="#ffffff" opacity=".06"/><circle cx="0" cy="${height}" r="${width * .48}" fill="${palette.accent}" opacity=".10"/><rect x="48" y="48" width="${width - 96}" height="${height - 96}" rx="34" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="3"/>`;
  const titleBacking = checklist
    ? `<rect x="92" y="${blockTop - 40}" width="${width - 184}" height="${blockH + 80}" rx="28" fill="#ffffff" fill-opacity=".82"/>`
    : minimal
      ? `<rect x="${split ? 112 : width * .09}" y="${blockTop - 35}" width="${split ? width * .79 : width * .82}" height="${blockH + 70}" rx="14" fill="#ffffff" fill-opacity=".46"/>`
      : "";
  const phoneWidth = width * .76;
  const phoneX = width * .12;
  const textColor = palette.foreground;
  const phone = `<rect x="${phoneX}" y="${phoneY - 88}" width="${phoneWidth}" height="118" rx="${style === "MINIMAL" ? 12 : 24}" fill="${palette.accent}"/><text x="${width / 2}" y="${phoneY - 12}" text-anchor="middle" font-family="${FONT}" font-size="${input.format === "REEL" ? 62 : 58}" font-weight="900" fill="${palette.accentText}">${PHONE}</text>`;
  const cta = `<rect x="${phoneX}" y="${ctaY - 62}" width="${phoneWidth}" height="100" rx="${style === "MINIMAL" ? 12 : 50}" fill="${palette.soft}" fill-opacity="${minimal || checklist ? ".92" : ".98"}"/><text x="${width / 2}" y="${ctaY}" text-anchor="middle" font-family="${FONT}" font-size="${input.format === "REEL" ? 43 : 38}" font-weight="800" fill="${checklist || minimal ? "#102b46" : palette.start}">${CTA}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.start}"/><stop offset="1" stop-color="${palette.end}"/></linearGradient><clipPath id="avatar"><circle cx="${logoX}" cy="${input.format === "REEL" ? 148 : 130}" r="58"/></clipPath></defs><rect width="100%" height="100%" rx="${minimal ? 12 : 42}" fill="url(#bg)"/>${frame}${logo}<text x="${pageTextX}" y="${input.format === "REEL" ? 260 : 230}" text-anchor="${pageAnchor}" font-family="${FONT}" font-size="${input.format === "REEL" ? 35 : 31}" font-weight="700" fill="${textColor}">${pageName}</text>${titleBacking}<text x="${centerX}" y="${titleY}" text-anchor="${anchor}" font-family="${FONT}" font-size="${titleFont}" font-weight="800" fill="${textColor}">${titleSvg}</text>${phone}${cta}<text x="${width / 2}" y="${hashtagY}" text-anchor="middle" font-family="${FONT}" font-size="${input.format === "REEL" ? 36 : 32}" font-weight="700" fill="${textColor}">${REQUIRED_HASHTAG}</text><text x="${width / 2}" y="${height - 80}" text-anchor="middle" font-family="${FONT}" font-size="28" fill="${textColor}" opacity=".78">আপনার প্রয়োজন জানিয়ে ইনবক্স করুন</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export const REQUIRED_BRAND_HASHTAG = REQUIRED_HASHTAG;
