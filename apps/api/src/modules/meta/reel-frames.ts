import { CREATIVE_FONT_FAMILY } from "../../lib/fonts.js";
import { REQUIRED_CTA, REQUIRED_HASHTAG, REQUIRED_PHONE } from "../content/safety.rules.js";
import { layoutLines } from "../content/creative.text.js";
import { getPalette } from "../content/asset.service.js";

const FONT = CREATIVE_FONT_FAMILY;
const END_CARD_TEXT = "আপনার সন্তানের জন্য টিউটর খুঁজছেন? মেসেঞ্জারে কথা বলুন।";
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Legacy parser kept for drafts created before structured scenes existed. */
export function getReelSceneLines(script: string | null, title: string) {
  const candidates = (script || "").split(/\r?\n/).map(line => line
    .replace(/^\s*(?:scene\s*\d+|দৃশ্য\s*\d+|\d{1,2}:\d{2}(?:\s*[-–]\s*\d{1,2}:\d{2})?)\s*[:—-]?\s*/i, "")
    .replace(/^(?:visual|visual direction|on-screen text|spoken line|voiceover|কথা|ভয়েসওভার|অন-স্ক্রিন টেক্সট)\s*[:：-]\s*/i, "")
    .replace(/[*#`]/g, "").trim())
    .filter(line => line.length >= 12 && line.length <= 150 && /[\u0980-\u09FF]/u.test(line));
  const unique = [...new Set(candidates)].slice(0, 3);
  while (unique.length < 3) unique.push([
    "সন্তানের শ্রেণি, বিষয় ও এলাকা স্পষ্ট করে জানান",
    "সময় ও প্রয়োজন মিলিয়ে উপযুক্ত হোম টিউটর খুঁজুন",
    "আপনার প্রয়োজন জানাতে মেসেঞ্জারে যোগাযোগ করুন",
  ][unique.length]!);
  return [title, ...unique, END_CARD_TEXT];
}

/** Frame texts for the video: hook, 3-4 scenes (structured when available), then the contact end card. */
export function resolveReelFrameTexts(content: { title: string; script: string | null; reelScenes?: unknown }): string[] {
  const stored = Array.isArray(content.reelScenes) ? content.reelScenes.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  if (stored.length >= 3) return [content.title, ...stored.slice(0, 4), END_CARD_TEXT];
  return getReelSceneLines(content.script, content.title);
}

/** Each Reel uses its own palette (chosen per post), and scenes alternate the gradient so the video has rhythm. */
export async function reelFrameSvg(text: string, index: number, total: number, paletteName?: string | null) {
  const palette = getPalette(paletteName);
  const alternate = index % 2 === 1;
  const fill = alternate ? palette.deep2 : palette.deep1;
  const accentFill = index === total - 1 || index === 0 ? palette.accent : alternate ? "#ffffff" : palette.accent;
  const ending = index === total - 1;
  const layout = await layoutLines(text, { maxWidth: 860, sizes: ending ? [60, 54, 48] : [76, 68, 60, 52], maxLines: 5 });
  const lineHeight = Math.round(layout.fontSize * 1.32);
  const startY = (ending ? 660 : 760) - Math.round(((layout.lines.length - 1) * lineHeight) / 2);
  const title = layout.lines.map((line, i) => `<tspan x="540" dy="${i === 0 ? 0 : lineHeight}">${xml(line)}</tspan>`).join("");
  const progress = Array.from({ length: total }, (_, i) => `<rect x="${540 - total * 30 + i * 60 + 6}" y="1735" width="48" height="8" rx="4" fill="${accentFill}" opacity="${i === index ? 1 : 0.3}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><linearGradient id="g" x1="${alternate ? 1 : 0}" y1="0" x2="${alternate ? 0 : 1}" y2="1"><stop stop-color="${fill}"/><stop offset="1" stop-color="${alternate ? palette.deep1 : palette.deep2}"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#g)"/><circle cx="1030" cy="210" r="300" fill="${accentFill}" opacity=".12"/><circle cx="20" cy="1760" r="380" fill="${accentFill}" opacity=".09"/><rect x="64" y="64" width="952" height="1792" rx="42" fill="none" stroke="${accentFill}" stroke-width="4" opacity=".5"/><text x="540" y="180" font-family="${FONT}" font-size="40" font-weight="800" text-anchor="middle" fill="${accentFill}">TUTORLINK TUITION MEDIA</text><text x="540" y="${startY}" font-family="${FONT}" font-size="${layout.fontSize}" font-weight="800" text-anchor="middle" fill="#ffffff">${title}</text><rect x="120" y="${ending ? 1050 : 1260}" width="840" height="120" rx="26" fill="${accentFill}"/><text x="540" y="${ending ? 1135 : 1345}" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="800" fill="${palette.deep1}">${REQUIRED_PHONE}</text><text x="540" y="${ending ? 1280 : 1470}" text-anchor="middle" font-family="${FONT}" font-size="46" font-weight="800" fill="#ffffff">${REQUIRED_CTA}</text><text x="540" y="${ending ? 1390 : 1560}" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="700" fill="${accentFill}">${REQUIRED_HASHTAG}</text>${progress}</svg>`;
}

export async function createReelFramePreview(content: { title: string; script: string | null; reelScenes?: unknown; designPalette?: string | null }) {
  const texts = resolveReelFrameTexts(content);
  return Promise.all(texts.map(async (text, index, all) => ({ index, title: text, svg: await reelFrameSvg(text, index, all.length, content.designPalette) })));
}
