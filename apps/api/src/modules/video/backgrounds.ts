import { env } from "../../config/env.js";
import { getPalette } from "../content/asset.service.js";
import { svgToPng } from "../content/render.service.js";
import { VISUALS, type VisualKey } from "./reel-plan.js";

type Hooks = { fetchImpl: typeof fetch };
const hooks: Hooks = { fetchImpl: (...args) => fetch(...args) };
export function __setBackgroundHooks(overrides: Partial<Hooks>) { const previous = { ...hooks }; Object.assign(hooks, overrides); return () => Object.assign(hooks, previous); }
const searchCache = new Map<string, Array<{ id: number; url: string }>>();

/**
 * A free stock photo for a scene (Pexels licence: free for commercial use, no attribution required). Returns null when no key is set or anything
 * goes wrong, in which case the studio draws an illustrated background instead. A failed photo never fails the video.
 */
export async function loadPhoto(visual: VisualKey, index: number, width: number, height: number): Promise<Buffer | null> {
  if (!env.PEXELS_API_KEY) return null;
  try {
    let results = searchCache.get(visual);
    if (!results) {
      const response = await hooks.fetchImpl(`https://api.pexels.com/v1/search?query=${encodeURIComponent(VISUALS[visual].query)}&orientation=portrait&size=medium&per_page=15`, { headers: { Authorization: env.PEXELS_API_KEY }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      const payload = await response.json() as { photos?: Array<{ id: number; src?: { portrait?: string; large?: string } }> };
      results = (payload.photos ?? []).map(photo => ({ id: photo.id, url: photo.src?.portrait || photo.src?.large || "" })).filter(photo => /^https:\/\/images\.pexels\.com\//.test(photo.url));
      if (searchCache.size > 30) searchCache.clear();
      searchCache.set(visual, results);
    }
    if (results.length === 0) return null;
    const pick = results[(index * 3 + Math.floor(Date.now() / 86_400_000)) % results.length]!;
    const image = await hooks.fetchImpl(pick.url, { signal: AbortSignal.timeout(10_000) });
    if (!image.ok || !/^image\//.test(image.headers.get("content-type") || "")) return null;
    const bytes = Buffer.from(await image.arrayBuffer());
    if (bytes.length > 4_000_000) return null;
    const sharp = (await import("sharp")).default;
    return await sharp(bytes).resize(width, height, { fit: "cover", position: "attention" }).jpeg({ quality: 86 }).toBuffer();
  } catch { return null; }
}

const ICON_FOR: Record<VisualKey, string> = {
  "struggling-child": "question", "worried-parent": "family", "tutor-teaching": "board", "happy-family": "heart", "study-desk": "books", "classroom": "board",
  "campus": "cap", "online-class": "laptop", "exam-prep": "sheet", "books": "books", "graduation": "cap", "phone-chat": "chat",
};
/** Simple flat pictograms (200x200 box, white) used when no photo is available, so scenes still have a clear visual subject. */
const ICONS: Record<string, string> = {
  books: '<rect x="30" y="60" width="34" height="110" rx="5"/><rect x="70" y="40" width="34" height="130" rx="5"/><rect x="110" y="70" width="34" height="100" rx="5"/><path d="M150 80 l30 8 -22 84 -30 -8z"/>',
  cap: '<polygon points="100,40 190,80 100,120 10,80"/><path d="M45 105 v40 q55 35 110 0 v-40 l-55 26z"/><rect x="176" y="84" width="8" height="55" rx="4"/><circle cx="180" cy="148" r="9"/>',
  chat: '<path d="M30 40 h140 a14 14 0 0 1 14 14 v70 a14 14 0 0 1 -14 14 h-78 l-40 32 v-32 h-22 a14 14 0 0 1 -14 -14 v-70 a14 14 0 0 1 14 -14z"/><circle cx="70" cy="89" r="9" fill="#000" fill-opacity=".35"/><circle cx="100" cy="89" r="9" fill="#000" fill-opacity=".35"/><circle cx="130" cy="89" r="9" fill="#000" fill-opacity=".35"/>',
  family: '<circle cx="60" cy="55" r="22"/><path d="M25 150 q0 -55 35 -55 q35 0 35 55z"/><circle cx="130" cy="82" r="16"/><path d="M104 150 q0 -40 26 -40 q26 0 26 40z"/><circle cx="168" cy="108" r="11"/><path d="M152 150 q0 -26 16 -26 q16 0 16 26z"/>',
  heart: '<path d="M100 172 C20 112 22 52 64 48 C84 46 96 58 100 70 C104 58 116 46 136 48 C178 52 180 112 100 172z"/>',
  board: '<rect x="20" y="30" width="160" height="104" rx="10"/><rect x="34" y="44" width="132" height="76" rx="5" fill="#000" fill-opacity=".30"/><rect x="48" y="62" width="70" height="8" rx="4"/><rect x="48" y="82" width="96" height="8" rx="4"/><rect x="70" y="140" width="10" height="40"/><rect x="120" y="140" width="10" height="40"/>',
  laptop: '<rect x="38" y="40" width="124" height="84" rx="8"/><rect x="48" y="50" width="104" height="64" rx="3" fill="#000" fill-opacity=".30"/><path d="M14 138 h172 l-10 24 h-152z"/>',
  sheet: '<rect x="46" y="22" width="108" height="150" rx="10"/><rect x="62" y="52" width="76" height="8" rx="4" fill="#000" fill-opacity=".35"/><rect x="62" y="76" width="76" height="8" rx="4" fill="#000" fill-opacity=".35"/><path d="M66 118 l14 14 30 -32" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>',
  question: '<circle cx="100" cy="100" r="76"/><text x="100" y="140" text-anchor="middle" font-size="120" font-weight="800" fill="#000" fill-opacity=".38">?</text>',
};

/** Brand background for a scene when no photo exists: the post's palette, soft shapes, and a large flat pictogram of the scene's subject. Different for every scene. */
export async function gradientBackground(paletteName: string, seed: number, width: number, height: number, visual?: VisualKey): Promise<Buffer> {
  const palette = getPalette(paletteName);
  const a = (seed * 37) % 100; const b = (seed * 53 + 20) % 100; const c = (seed * 29 + 55) % 100;
  const icon = visual ? ICONS[ICON_FOR[visual]] : "";
  const iconSvg = icon ? `<g transform="translate(150 330) scale(2.1)" fill="#ffffff" fill-opacity=".20" font-family="Noto Sans Bengali">${icon}</g>` : "";
  return svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 720 1280"><defs><linearGradient id="g" x1="0" y1="0" x2="${seed % 2 ? 1 : 0.3}" y2="1"><stop offset="0" stop-color="${palette.deep1}"/><stop offset="1" stop-color="${palette.deep2}"/></linearGradient></defs><rect width="720" height="1280" fill="url(#g)"/><circle cx="${a * 7}" cy="${200 + b * 4}" r="${260 + c}" fill="${palette.accent}" fill-opacity=".10"/><circle cx="${700 - b * 5}" cy="${820 + a * 3}" r="${300 + a}" fill="#fff" fill-opacity=".07"/><circle cx="${c * 6}" cy="${1180 - b}" r="190" fill="${palette.accent}" fill-opacity=".12"/>${iconSvg}</svg>`);
}
