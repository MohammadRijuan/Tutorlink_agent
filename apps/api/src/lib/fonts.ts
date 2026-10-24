import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Why this exists: creatives are rasterised with sharp (librsvg + Pango/HarfBuzz, which shapes Bangla conjuncts correctly).
 * Serverless runtimes such as Vercel ship no Bengali fonts, so every glyph, including the mandatory phone number, would render
 * as empty boxes. We bundle Noto Sans Bengali (SIL OFL) and point fontconfig at it BEFORE sharp renders any text.
 */
const REQUIRED_FONT_FILES = ["NotoSansBengali-Regular.ttf", "NotoSansBengali-Bold.ttf", "NotoSansBengali-ExtraBold.ttf"];
export const CREATIVE_FONT_FAMILY = "Noto Sans Bengali";

export class FontUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "FontUnavailableError"; }
}

let cachedDir: string | null = null;
let configured = false;

export function resolveFontsDir(): string {
  if (cachedDir) return cachedDir;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.TUTORLINK_FONTS_DIR,
    resolve(here, "../../assets/fonts"),        // src/lib -> apps/api/assets/fonts (tsx / ts-node)
    resolve(here, "../../../assets/fonts"),     // dist/src/lib -> apps/api/assets/fonts (compiled)
    resolve(process.cwd(), "assets/fonts"),
    resolve(process.cwd(), "apps/api/assets/fonts"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (REQUIRED_FONT_FILES.every(file => existsSync(join(candidate, file)))) { cachedDir = candidate; return candidate; }
  }
  throw new FontUnavailableError("Bundled Bangla fonts were not found. Creatives cannot be rendered safely; check that assets/fonts is deployed with the API function.");
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Idempotent. Must run before the first sharp text render in the process. */
export function ensureFontConfig(): string {
  const fontsDir = resolveFontsDir();
  if (configured) return fontsDir;
  const base = join(tmpdir(), "tutorlink-fontconfig");
  mkdirSync(join(base, "cache"), { recursive: true });
  const configFile = join(base, "fonts.conf");
  writeFileSync(configFile, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${xmlEscape(fontsDir)}</dir>\n  <cachedir>${xmlEscape(join(base, "cache"))}</cachedir>\n  <match target="pattern"><edit name="family" mode="append_last"><string>${CREATIVE_FONT_FAMILY}</string></edit></match>\n</fontconfig>\n`);
  process.env.FONTCONFIG_FILE = configFile;
  process.env.FONTCONFIG_PATH = base;
  configured = true;
  return fontsDir;
}

// ---- Glyph coverage (prevents "tofu" boxes from ever reaching a published creative) ----
let coverage: Set<number> | null = null;

function readCmap(buffer: Buffer): Set<number> {
  const numTables = buffer.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (buffer.toString("ascii", record, record + 4) === "cmap") { cmapOffset = buffer.readUInt32BE(record + 8); break; }
  }
  if (cmapOffset < 0) throw new FontUnavailableError("Font file has no cmap table.");
  const count = buffer.readUInt16BE(cmapOffset + 2);
  const codes = new Set<number>();
  for (let i = 0; i < count; i++) {
    const subtable = cmapOffset + buffer.readUInt32BE(cmapOffset + 4 + i * 8 + 4);
    const format = buffer.readUInt16BE(subtable);
    if (format === 4) {
      const segCount = buffer.readUInt16BE(subtable + 6) / 2;
      const endBase = subtable + 14; const startBase = endBase + segCount * 2 + 2;
      for (let s = 0; s < segCount; s++) {
        const end = buffer.readUInt16BE(endBase + s * 2); const start = buffer.readUInt16BE(startBase + s * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end; c++) codes.add(c);
      }
    } else if (format === 12) {
      const groups = buffer.readUInt32BE(subtable + 12);
      for (let g = 0; g < groups; g++) {
        const start = buffer.readUInt32BE(subtable + 16 + g * 12); const end = buffer.readUInt32BE(subtable + 20 + g * 12);
        for (let c = start; c <= end; c++) codes.add(c);
      }
    }
  }
  return codes;
}

export function getGlyphCoverage(): Set<number> {
  if (!coverage) coverage = readCmap(readFileSync(join(resolveFontsDir(), "NotoSansBengali-Regular.ttf")));
  return coverage;
}

/** Characters in `text` that the bundled font cannot draw (emoji, unusual symbols). Whitespace and zero-width joiners are ignored. */
export function findUnsupportedCharacters(text: string): string[] {
  const covered = getGlyphCoverage();
  const missing = new Set<string>();
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0x200c || code === 0x200d || /\s/u.test(char)) continue; // ZWNJ/ZWJ are shaping controls, not glyphs
    if (!covered.has(code)) missing.add(char);
  }
  return [...missing];
}

/** Removes characters the font cannot draw, then normalises whitespace. */
export function sanitizeForCreative(text: string): string {
  const covered = getGlyphCoverage();
  let out = "";
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (code === 0x200c || code === 0x200d || /\s/u.test(char) || covered.has(code)) out += char;
  }
  return out.replace(/\s+/g, " ").trim();
}
