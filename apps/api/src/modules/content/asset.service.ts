import { createHash } from "node:crypto";
import type { ResolvedVisualStyle, VisualStyle } from "./content.service.js";
import { CREATIVE_FONT_FAMILY, sanitizeForCreative } from "../../lib/fonts.js";
import { fitSingleLine, layoutLines } from "./creative.text.js";

const FONT = CREATIVE_FONT_FAMILY;
const PHONE = "01886-603858";
const CTA = "মেসেঞ্জারে যোগাযোগ করুন";
const REQUIRED_HASHTAG = "#TutorlinkTuitionMedia";

/** Every layout the agent may use. Order matters only for tie-breaking; selection avoids recently used ones. */
export const STYLE_ROTATION: ResolvedVisualStyle[] = ["BAND_CLASSIC", "BOLD_HOOK", "CARD_STACK", "SPLIT_LAYOUT", "SPOTLIGHT", "CHECKLIST", "DIAGONAL", "MINIMAL", "EDITORIAL", "WARM"];

export const PALETTE_NAMES = ["OCEAN", "SKY", "SUNRISE", "FOREST", "ROYAL", "ROSE", "TEAL", "SLATE"] as const;
export type PaletteName = typeof PALETTE_NAMES[number];
export function getPalette(name?: string | null) { return PALETTES[(PALETTE_NAMES as readonly string[]).includes(name ?? "") ? (name as PaletteName) : "OCEAN"]; }
export type PaletteDef = { deep1: string; deep2: string; light1: string; light2: string; accent: string };
const PALETTES: Record<PaletteName, PaletteDef> = {
  OCEAN: { deep1: "#0b2440", deep2: "#176b70", light1: "#e3eef9", light2: "#9ec0ec", accent: "#f4b942" },
  SKY: { deep1: "#123a73", deep2: "#2f6fd0", light1: "#e4f1ff", light2: "#a8d0ff", accent: "#ffd24d" },
  SUNRISE: { deep1: "#4a1d2f", deep2: "#b4452f", light1: "#fff1de", light2: "#ffd3a1", accent: "#ffc857" },
  FOREST: { deep1: "#0f3d2e", deep2: "#2a7f62", light1: "#e3f4ea", light2: "#a9dcc0", accent: "#ffd166" },
  ROYAL: { deep1: "#241746", deep2: "#56378a", light1: "#ece6fa", light2: "#c1b1ee", accent: "#f6c85f" },
  ROSE: { deep1: "#5a1a3a", deep2: "#b23a6b", light1: "#fde8f0", light2: "#f6b5cd", accent: "#ffd8a8" },
  TEAL: { deep1: "#08403f", deep2: "#14808a", light1: "#dff5f4", light2: "#9edbd8", accent: "#ffcf5c" },
  SLATE: { deep1: "#1f2a37", deep2: "#3f5368", light1: "#eef2f6", light2: "#c9d4df", accent: "#f4b942" },
};

type Backing = "none" | "soft" | "card";
type StyleSpec = { mode: "dark" | "light"; align: "center" | "left"; band: "pill" | "full"; backing: Backing; defaultPalette: PaletteName };
const STYLE_SPECS: Record<ResolvedVisualStyle, StyleSpec> = {
  BAND_CLASSIC: { mode: "light", align: "center", band: "full", backing: "none", defaultPalette: "SKY" },
  BOLD_HOOK: { mode: "dark", align: "center", band: "pill", backing: "none", defaultPalette: "OCEAN" },
  CARD_STACK: { mode: "light", align: "center", band: "pill", backing: "card", defaultPalette: "TEAL" },
  SPLIT_LAYOUT: { mode: "dark", align: "left", band: "pill", backing: "none", defaultPalette: "SLATE" },
  SPOTLIGHT: { mode: "dark", align: "center", band: "full", backing: "none", defaultPalette: "ROYAL" },
  CHECKLIST: { mode: "light", align: "center", band: "pill", backing: "card", defaultPalette: "FOREST" },
  DIAGONAL: { mode: "light", align: "left", band: "full", backing: "none", defaultPalette: "SUNRISE" },
  MINIMAL: { mode: "light", align: "center", band: "pill", backing: "soft", defaultPalette: "SLATE" },
  EDITORIAL: { mode: "dark", align: "center", band: "pill", backing: "none", defaultPalette: "ROYAL" },
  WARM: { mode: "dark", align: "center", band: "pill", backing: "none", defaultPalette: "ROSE" },
};

export type CreativeFormat = "POST" | "REEL" | "LINK";
const DIMENSIONS: Record<CreativeFormat, { W: number; H: number }> = { POST: { W: 1200, H: 1200 }, REEL: { W: 1080, H: 1920 }, LINK: { W: 1200, H: 630 } };

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export type DesignChoice = { style: ResolvedVisualStyle; palette: PaletteName };
type RecentDesign = { visualStyle?: string | null; designPalette?: string | null };

/**
 * Picks a layout + colour palette so consecutive posts never look alike: the style is not one of the last 5 used,
 * the palette is not one of the last 3, and the exact combination has not appeared in the last 14 posts.
 */
export function chooseDesign(seed: string, recent: RecentDesign[] = [], requested?: VisualStyle): DesignChoice {
  const digest = createHash("sha256").update(seed || "tutorlink").digest();
  const styles = requested && requested !== "AUTO" ? [requested as ResolvedVisualStyle] : STYLE_ROTATION;
  const styleStart = digest.readUInt32BE(0) % styles.length;
  const paletteStart = digest.readUInt32BE(4) % PALETTE_NAMES.length;
  const recentStyles = recent.slice(0, 5).map(item => item.visualStyle);
  const recentPalettes = recent.slice(0, 3).map(item => item.designPalette);
  const recentCombos = new Set(recent.slice(0, 14).map(item => `${item.visualStyle}:${item.designPalette}`));
  const attempts: Array<(style: string, palette: string) => boolean> = [
    (style, palette) => !recentStyles.includes(style) && !recentPalettes.includes(palette) && !recentCombos.has(`${style}:${palette}`),
    (style, palette) => !recentStyles.slice(0, 2).includes(style) && !recentPalettes.slice(0, 1).includes(palette) && !recentCombos.has(`${style}:${palette}`),
    (style, palette) => !recentCombos.has(`${style}:${palette}`),
  ];
  for (const accept of attempts) {
    for (let s = 0; s < styles.length; s++) {
      for (let p = 0; p < PALETTE_NAMES.length; p++) {
        const style = styles[(styleStart + s) % styles.length]!;
        const palette = PALETTE_NAMES[(paletteStart + p) % PALETTE_NAMES.length]!;
        if (accept(style, palette)) return { style, palette };
      }
    }
  }
  return { style: styles[styleStart]!, palette: PALETTE_NAMES[paletteStart]! };
}

/** Kept for callers that only need a style. */
export function resolveVisualStyle(requested: VisualStyle | undefined, seed: string, avoidRecent: string[] = []): ResolvedVisualStyle {
  return chooseDesign(seed, avoidRecent.map(visualStyle => ({ visualStyle })), requested).style;
}

const pictureCache = new Map<string, string>();
async function embedProfilePicture(url?: string | null) {
  if (!url || !/^https:\/\//i.test(url)) return "";
  const cached = pictureCache.get(url);
  if (cached !== undefined) return cached;
  try { const host = new URL(url).hostname.toLowerCase(); if (!(host === "facebook.com" || host.endsWith(".facebook.com") || host.endsWith(".fbcdn.net") || host.endsWith(".fbsbx.com"))) return ""; } catch { return ""; }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const type = response.headers.get("content-type") || "";
    const length = Number(response.headers.get("content-length") || 0);
    if (!response.ok || !/^image\/(png|jpeg|webp)$/i.test(type) || (length && length > 1_000_000)) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 1_000_000) return "";
    const dataUrl = `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
    if (pictureCache.size > 8) pictureCache.clear();
    pictureCache.set(url, dataUrl);
    return dataUrl;
  } catch { return ""; }
}

type Colors = { bgA: string; bgB: string; text: string; accent: string; onAccent: string; soft: string; ctaText: string; deep: string; dark: boolean };
type Rect = { x: number; y: number; w: number; h: number };
type DecoContext = { W: number; H: number; c: Colors; block: Rect; wide: boolean; story: boolean; textX: number };

const DECORATIONS: Record<ResolvedVisualStyle, (x: DecoContext) => string> = {
  BOLD_HOOK: x => `<circle cx="${x.W}" cy="0" r="${x.W * 0.44}" fill="#fff" opacity=".07"/><circle cx="0" cy="${x.H}" r="${x.W * 0.48}" fill="${x.c.accent}" opacity=".11"/><rect x="40" y="40" width="${x.W - 80}" height="${x.H - 80}" rx="34" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="3"/>`,
  CHECKLIST: x => `<rect x="36" y="36" width="${x.W - 72}" height="${x.H - 72}" rx="40" fill="#fff" fill-opacity=".5"/>`,
  SPLIT_LAYOUT: x => `<path d="M0 0 H${Math.round(x.W * 0.2)} V${x.H} H0 Z" fill="${x.c.accent}" fill-opacity=".16"/><rect x="40" y="40" width="${x.W - 80}" height="${x.H - 80}" rx="26" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="3"/><path d="M${x.textX - 34} ${x.block.y + 6} V${x.block.y + x.block.h - 6}" stroke="${x.c.accent}" stroke-width="9" stroke-linecap="round"/>`,
  MINIMAL: x => `<rect x="34" y="34" width="${x.W - 68}" height="${x.H - 68}" rx="18" fill="none" stroke="${x.c.deep}" stroke-opacity=".25" stroke-width="3"/><path d="M${x.W * 0.1} ${x.block.y - 26} H${x.W * 0.9}" stroke="${x.c.accent}" stroke-width="10" stroke-linecap="round"/>`,
  EDITORIAL: x => `<circle cx="${x.W - 70}" cy="${x.H * 0.3}" r="${x.W * 0.2}" fill="${x.c.accent}" fill-opacity=".14"/><circle cx="${x.W - 70}" cy="${x.H * 0.3}" r="${x.W * 0.27}" fill="none" stroke="${x.c.accent}" stroke-opacity=".3" stroke-width="5"/><circle cx="70" cy="${x.H - 80}" r="${x.W * 0.26}" fill="${x.c.accent}" fill-opacity=".1"/>`,
  WARM: x => `<path d="M0 ${x.H * 0.72} Q${x.W * 0.45} ${x.H * 0.52} ${x.W} ${x.H * 0.74} V${x.H} H0 Z" fill="${x.c.accent}" fill-opacity=".13"/><path d="M0 ${x.H * 0.82} Q${x.W * 0.55} ${x.H * 0.64} ${x.W} ${x.H * 0.84} V${x.H} H0 Z" fill="${x.c.accent}" fill-opacity=".09"/><circle cx="${x.W - 40}" cy="100" r="${x.W * 0.22}" fill="${x.c.accent}" fill-opacity=".12"/>`,
  BAND_CLASSIC: x => `<circle cx="${x.W * 0.92}" cy="${x.H * 0.16}" r="${x.W * 0.3}" fill="#fff" fill-opacity=".28"/><circle cx="${x.W * 0.04}" cy="${x.H * 0.62}" r="${x.W * 0.22}" fill="#fff" fill-opacity=".2"/>`,
  SPOTLIGHT: x => `<ellipse cx="${x.W / 2}" cy="${x.block.y + x.block.h / 2}" rx="${x.W * 0.62}" ry="${Math.max(x.block.h * 1.1, x.H * 0.28)}" fill="url(#spot)"/><rect x="${x.W / 2 - 70}" y="${x.block.y + x.block.h + 14}" width="140" height="10" rx="5" fill="${x.c.accent}"/>`,
  DIAGONAL: x => `<polygon points="0,${x.H * 0.64} ${x.W},${x.H * 0.4} ${x.W},${x.H} 0,${x.H}" fill="${x.c.accent}" fill-opacity=".16"/><polygon points="${x.W * 0.7},0 ${x.W},0 ${x.W},${x.H * 0.17}" fill="${x.c.accent}" fill-opacity=".45"/><path d="M${x.textX - 30} ${x.block.y + 4} V${x.block.y + x.block.h - 4}" stroke="${x.c.deep}" stroke-width="8" stroke-linecap="round"/>`,
  CARD_STACK: x => `<rect x="${x.block.x + 26}" y="${x.block.y + 26}" width="${x.block.w}" height="${x.block.h}" rx="34" fill="${x.c.accent}" fill-opacity=".55"/><rect x="${x.block.x + 13}" y="${x.block.y + 13}" width="${x.block.w}" height="${x.block.h}" rx="34" fill="${x.c.deep}" fill-opacity=".14"/>`,
};

/** Drawn above the title card (needed when a decoration must overlap the card edge). */
const OVERLAYS: Partial<Record<ResolvedVisualStyle, (x: DecoContext) => string>> = {
  CHECKLIST: x => `<circle cx="${x.block.x + x.block.w - 6}" cy="${x.block.y + 2}" r="40" fill="${x.c.accent}"/><path d="M${x.block.x + x.block.w - 26} ${x.block.y + 2} l14 15 l28 -32" fill="none" stroke="${x.c.onAccent}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
};

/**
 * Self-contained SVG for a feed banner (1200x1200), Reel cover (1080x1920) or wide link-card image (1200x630).
 * The phone number, Messenger call to action and hashtag are always drawn; text is measured with the real shaping engine so nothing overflows.
 */
export async function createBrandedAsset(input: {
  title: string;
  subtitle?: string | null;
  pageName?: string | null;
  profilePicture?: string | null;
  format: CreativeFormat;
  visualStyle?: ResolvedVisualStyle;
  palette?: PaletteName | string | null;
}) {
  const style: ResolvedVisualStyle = input.visualStyle && STYLE_SPECS[input.visualStyle] ? input.visualStyle : "BOLD_HOOK";
  const spec = STYLE_SPECS[style];
  const paletteName: PaletteName = (PALETTE_NAMES as readonly string[]).includes(input.palette ?? "") ? (input.palette as PaletteName) : spec.defaultPalette;
  const pal = PALETTES[paletteName];
  const dark = spec.mode === "dark";
  const c: Colors = { bgA: dark ? pal.deep1 : pal.light1, bgB: dark ? pal.deep2 : pal.light2, text: dark ? "#ffffff" : pal.deep1, accent: pal.accent, onAccent: pal.deep1, soft: "#ffffff", ctaText: pal.deep1, deep: pal.deep1, dark };

  const { W, H } = DIMENSIONS[input.format];
  const wide = input.format === "LINK";
  const story = input.format === "REEL";
  const left = wide || spec.align === "left";
  const title = sanitizeForCreative(input.title) || "TutorLink Tuition Media";
  const subtitle = input.subtitle ? sanitizeForCreative(input.subtitle) : "";
  const pageName = sanitizeForCreative(input.pageName || "TutorLink Tuition Media").slice(0, 70) || "TutorLink Tuition Media";
  const pad = 110;

  // ---- geometry ----
  const textX = wide ? 64 : left ? pad + 44 : W / 2;
  const anchor = left ? "start" : "middle";
  const textMaxW = wide ? 640 : left ? W - textX - pad : W - pad * 2 - 40;
  const titleSizes = wide ? [56, 50, 44, 40] : story ? [68, 60, 54, 48] : [60, 54, 48, 42];
  const subSizes = wide ? [30, 28, 26] : story ? [38, 34, 30] : [34, 31, 28];
  const titleLayout = await layoutLines(title, { maxWidth: textMaxW, sizes: titleSizes, maxLines: wide ? 3 : story ? 4 : 3 });
  const subLayout = subtitle ? await layoutLines(subtitle, { maxWidth: textMaxW, sizes: subSizes, maxLines: wide ? 3 : 2, weight: "Bold" }) : null;
  const titleLH = Math.round(titleLayout.fontSize * 1.3);
  const subLH = subLayout ? Math.round(subLayout.fontSize * 1.42) : 0;
  const gap = subLayout ? 26 : 0;
  const blockH = titleLayout.lines.length * titleLH + gap + (subLayout ? subLayout.lines.length * subLH : 0);

  let headerBottom: number; let regionTop: number; let regionBottom: number; let footerTop = 0;
  if (wide) { headerBottom = 120; regionTop = 130; regionBottom = H - 40; }
  else {
    const cy = story ? 148 : 130;
    headerBottom = left ? cy + 70 : cy + 128;
    footerTop = H - (story ? 560 : 440);
    regionTop = headerBottom + 16; regionBottom = footerTop - 34;
  }
  const blockTop = Math.round(regionTop + Math.max(0, regionBottom - regionTop - blockH) / 2);
  const pad2 = spec.backing === "none" ? 0 : spec.backing === "card" ? 44 : 34;
  const blockRect: Rect = wide
    ? { x: textX - 30, y: blockTop - pad2, w: textMaxW + 60, h: blockH + pad2 * 2 }
    : { x: Math.round(pad - 20), y: blockTop - pad2, w: W - (pad - 20) * 2, h: blockH + pad2 * 2 };
  const decoBlock: Rect = spec.backing === "none" ? { x: textX - 30, y: blockTop, w: textMaxW + 60, h: blockH } : blockRect;

  // ---- text drawing ----
  const titleBase = blockTop + Math.round(titleLayout.fontSize * 0.92);
  const titleSvg = titleLayout.lines.map((line, i) => `<tspan x="${textX}" dy="${i === 0 ? 0 : titleLH}">${xml(line)}</tspan>`).join("");
  const subBase = blockTop + titleLayout.lines.length * titleLH + gap + (subLayout ? Math.round(subLayout.fontSize * 0.92) : 0);
  const subSvg = subLayout ? subLayout.lines.map((line, i) => `<tspan x="${textX}" dy="${i === 0 ? 0 : subLH}">${xml(line)}</tspan>`).join("") : "";
  const backing = spec.backing === "card"
    ? `<rect x="${blockRect.x}" y="${blockRect.y}" width="${blockRect.w}" height="${blockRect.h}" rx="34" fill="#ffffff" fill-opacity=".96"/>`
    : spec.backing === "soft" ? `<rect x="${blockRect.x}" y="${blockRect.y}" width="${blockRect.w}" height="${blockRect.h}" rx="16" fill="#ffffff" fill-opacity=".55"/>` : "";
  const mainText = `<text x="${textX}" y="${titleBase}" text-anchor="${anchor}" font-family="${FONT}" font-size="${titleLayout.fontSize}" font-weight="800" fill="${c.text}">${titleSvg}</text>`
    + (subLayout ? `<text x="${textX}" y="${subBase}" text-anchor="${anchor}" font-family="${FONT}" font-size="${subLayout.fontSize}" font-weight="700" fill="${c.text}" fill-opacity=".9">${subSvg}</text>` : "");

  // ---- header (logo + page name) ----
  const picture = xml(await embedProfilePicture(input.profilePicture));
  const logoR = wide ? 34 : 58;
  const logoCx = wide ? textX + logoR : left ? pad + 44 + logoR - 20 : W / 2;
  const logoCy = wide ? 70 : story ? 148 : 130;
  const logo = picture
    ? `<image href="${picture}" x="${logoCx - logoR}" y="${logoCy - logoR}" width="${logoR * 2}" height="${logoR * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar)"/>`
    : `<circle cx="${logoCx}" cy="${logoCy}" r="${logoR}" fill="${c.accent}"/><text x="${logoCx}" y="${logoCy + Math.round(logoR * 0.38)}" text-anchor="middle" font-family="${FONT}" font-size="${Math.round(logoR * 0.9)}" font-weight="800" fill="${c.onAccent}">T</text>`;
  const nameSize = await fitSingleLine(pageName, wide ? 500 : W - 2 * pad, wide ? [28, 26, 24] : [36, 32, 28], "ExtraBold");
  const pageText = wide
    ? `<text x="${logoCx + logoR + 20}" y="${logoCy + 10}" font-family="${FONT}" font-size="${nameSize}" font-weight="800" fill="${c.text}">${xml(pageName)}</text>`
    : left
      ? `<text x="${logoCx + logoR + 24}" y="${logoCy + 12}" font-family="${FONT}" font-size="${nameSize}" font-weight="800" fill="${c.text}">${xml(pageName)}</text>`
      : `<text x="${W / 2}" y="${logoCy + logoR + 52}" text-anchor="middle" font-family="${FONT}" font-size="${nameSize}" font-weight="800" fill="${c.text}">${xml(pageName)}</text>`;

  // ---- contact block: phone band, Messenger call to action, hashtag ----
  let contact = "";
  if (wide) {
    const px = 790; const pw = 346;
    const phoneSize = await fitSingleLine(PHONE, pw - 36, [46, 42, 38, 34], "ExtraBold");
    const ctaSize = await fitSingleLine(CTA, pw - 40, [32, 30, 28, 26, 24, 22], "ExtraBold");
    const tagSize = await fitSingleLine(REQUIRED_HASHTAG, pw, [26, 24, 22, 20, 18], "Bold");
    contact = `<rect x="${px - 22}" y="104" width="${pw + 44}" height="410" rx="30" fill="${dark ? "#ffffff" : c.deep}" fill-opacity="${dark ? 0.1 : 0.08}"/>`
      + `<rect x="${px}" y="136" width="${pw}" height="104" rx="22" fill="${c.accent}"/><text x="${px + pw / 2}" y="${136 + 52 + Math.round(phoneSize * 0.36)}" text-anchor="middle" font-family="${FONT}" font-size="${phoneSize}" font-weight="800" fill="${c.onAccent}">${PHONE}</text>`
      + `<rect x="${px}" y="266" width="${pw}" height="92" rx="46" fill="${c.soft}"/><text x="${px + pw / 2}" y="${266 + 46 + Math.round(ctaSize * 0.34)}" text-anchor="middle" font-family="${FONT}" font-size="${ctaSize}" font-weight="800" fill="${c.ctaText}">${CTA}</text>`
      + `<text x="${px + pw / 2}" y="420" text-anchor="middle" font-family="${FONT}" font-size="${tagSize}" font-weight="700" fill="${c.text}" fill-opacity=".92">${REQUIRED_HASHTAG}</text>`;
  } else {
    const full = spec.band === "full";
    const bandX = full ? 0 : Math.round(W * 0.12); const bandW = full ? W : Math.round(W * 0.76);
    const bandY = full ? footerTop - 6 : footerTop; const bandH = full ? 140 : 118;
    const phoneSize = await fitSingleLine(PHONE, bandW - 120, story ? [66, 62, 56, 50] : [66, 62, 58, 52], "ExtraBold");
    const ctaW = Math.round(W * 0.76);
    const ctaSize = await fitSingleLine(CTA, ctaW - 70, story ? [46, 42, 38, 34] : [42, 38, 34, 30], "ExtraBold");
    const ctaY = footerTop + (full ? 164 : 146);
    const tagSize = await fitSingleLine(REQUIRED_HASHTAG, W - 160, [36, 32, 28, 24], "Bold");
    const tagY = footerTop + (story ? 560 : 440) - 66;
    contact = `<rect x="${bandX}" y="${bandY}" width="${bandW}" height="${bandH}" rx="${full ? 0 : style === "MINIMAL" ? 12 : 26}" fill="${c.accent}"/><text x="${W / 2}" y="${bandY + bandH / 2 + Math.round(phoneSize * 0.36)}" text-anchor="middle" font-family="${FONT}" font-size="${phoneSize}" font-weight="800" fill="${c.onAccent}">${PHONE}</text>`
      + `<rect x="${Math.round(W * 0.12)}" y="${ctaY}" width="${ctaW}" height="100" rx="${style === "MINIMAL" ? 14 : 50}" fill="${c.soft}" fill-opacity="${dark ? 0.98 : 0.95}"/><text x="${W / 2}" y="${ctaY + 50 + Math.round(ctaSize * 0.34)}" text-anchor="middle" font-family="${FONT}" font-size="${ctaSize}" font-weight="800" fill="${c.ctaText}">${CTA}</text>`
      + `<text x="${W / 2}" y="${tagY}" text-anchor="middle" font-family="${FONT}" font-size="${tagSize}" font-weight="700" fill="${c.text}" fill-opacity=".92">${REQUIRED_HASHTAG}</text>`;
  }

  const gradientDir = createHash("sha1").update(`${style}${paletteName}`).digest()[0]! % 2 === 0 ? { x2: 1, y2: 1 } : { x2: 0.2, y2: 1 };
  const decoContext: DecoContext = { W, H, c, block: decoBlock, wide, story, textX };
  const deco = DECORATIONS[style](decoContext);
  const overlay = OVERLAYS[style]?.(decoContext) ?? "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="bg" x1="0" y1="0" x2="${gradientDir.x2}" y2="${gradientDir.y2}"><stop offset="0" stop-color="${c.bgA}"/><stop offset="1" stop-color="${c.bgB}"/></linearGradient><radialGradient id="spot"><stop offset="0" stop-color="#ffffff" stop-opacity=".26"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient><clipPath id="avatar"><circle cx="${logoCx}" cy="${logoCy}" r="${logoR}"/></clipPath></defs><rect width="${W}" height="${H}" fill="url(#bg)"/>${deco}${backing}${overlay}${logo}${pageText}${mainText}${contact}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export const REQUIRED_BRAND_HASHTAG = REQUIRED_HASHTAG;
