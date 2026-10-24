import sharp from "sharp";
import { CREATIVE_FONT_FAMILY, ensureFontConfig, sanitizeForCreative } from "../../lib/fonts.js";

const escapeMarkup = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const widthCache = new Map<string, number>();

/** Width in px of `text` as the renderer will actually draw it (same Pango/HarfBuzz shaping as the final image). */
export async function measureTextWidth(text: string, size: number, weight: "Regular" | "Bold" | "ExtraBold" = "ExtraBold"): Promise<number> {
  ensureFontConfig();
  const key = `${weight}|${size}|${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  const { info } = await sharp({ text: { text: escapeMarkup(text), font: `${CREATIVE_FONT_FAMILY} ${weight} ${size}`, rgba: true, dpi: 72 } }).png().toBuffer({ resolveWithObject: true });
  if (widthCache.size > 2000) widthCache.clear();
  widthCache.set(key, info.width);
  return info.width;
}

export type TitleLayout = { lines: string[]; fontSize: number; truncated: boolean };

/** Greedy word wrap that shrinks the font until the headline fits `maxLines` lines inside `maxWidth`. */
export async function layoutLines(rawText: string, options: { maxWidth: number; sizes: number[]; maxLines: number; weight?: "Regular" | "Bold" | "ExtraBold" }): Promise<TitleLayout> {
  const text = sanitizeForCreative(rawText);
  const words = text.split(" ").filter(Boolean);
  const weight = options.weight ?? "ExtraBold";
  for (const [index, size] of options.sizes.entries()) {
    const lines: string[] = [];
    let ok = true;
    for (const word of words) {
      if ((await measureTextWidth(word, size, weight)) > options.maxWidth) { ok = false; break; }
      const current = lines[lines.length - 1];
      if (current !== undefined && (await measureTextWidth(`${current} ${word}`, size, weight)) <= options.maxWidth) lines[lines.length - 1] = `${current} ${word}`;
      else lines.push(word);
    }
    if (ok && lines.length <= options.maxLines) return { lines, fontSize: size, truncated: false };
    if (index === options.sizes.length - 1) {
      // Smallest size still too long: keep what fits and mark the cut with an ellipsis.
      const kept = ok ? lines.slice(0, options.maxLines) : [];
      if (kept.length === 0) kept.push("");
      let last = kept[kept.length - 1]!;
      while (last && (await measureTextWidth(`${last}…`, size, weight)) > options.maxWidth) last = last.split(" ").slice(0, -1).join(" ");
      kept[kept.length - 1] = `${last}…`;
      return { lines: kept, fontSize: size, truncated: true };
    }
  }
  return { lines: [text], fontSize: options.sizes[options.sizes.length - 1] ?? 40, truncated: false };
}
