import "../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

const fonts = await import("../fonts.js");
const text = await import("../../modules/content/creative.text.js");
const render = await import("../../modules/content/render.service.js");

test("bundled font covers Bangla, Bangla digits, Latin, the phone number and the hashtag", () => {
  assert.deepEqual(fonts.findUnsupportedCharacters("হোম টিউটর খোঁজার আগে যা জানাবেন ০১২৩৪৫৬৭৮৯ । 01886-603858 #TutorlinkTuitionMedia"), []);
});

test("emoji and symbols the font cannot draw are detected and stripped before rendering", () => {
  assert.deepEqual(fonts.findUnsupportedCharacters("পড়া 📚"), ["📚"]);
  assert.equal(fonts.sanitizeForCreative("পড়া 📚 শুরু"), "পড়া শুরু");
});

test("rendering uses ONLY the bundled fonts (no system fonts needed, as on Vercel) and draws real glyphs", async () => {
  fonts.ensureFontConfig();
  assert.match(process.env.FONTCONFIG_FILE ?? "", /tutorlink-fontconfig/);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="80" font-family="Noto Sans Bengali" font-size="56" fill="#000">হোম টিউটর</text></svg>`;
  const png = await render.svgToPng(svg);
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  let dark = 0; for (const value of data) if (value < 100) dark++;
  assert.equal(info.width, 600);
  assert.ok(dark > 1500, `expected visible ink, got ${dark} dark pixels`);
});

test("measured Bangla layout wraps within the width and shrinks long headlines instead of overflowing", async () => {
  const short = await text.layoutLines("সন্তানের জন্য উপযুক্ত হোম টিউটর", { maxWidth: 900, sizes: [60, 54, 48], maxLines: 3 });
  assert.ok(short.lines.length >= 1 && short.lines.length <= 3);
  for (const line of short.lines) assert.ok(await text.measureTextWidth(line, short.fontSize) <= 900);
  const long = await text.layoutLines("হোম টিউটর খোঁজার আগে অভিভাবকের যে তথ্যগুলো প্রস্তুত রাখা দরকার এবং কীভাবে সঠিক প্রশ্ন করবেন সেই বিষয়ে একটি সম্পূর্ণ গাইড যা প্রতিটি পরিবারের কাজে লাগবে", { maxWidth: 500, sizes: [60, 48], maxLines: 2 });
  assert.ok(long.lines.length <= 2);
  assert.ok(long.truncated && long.lines[long.lines.length - 1]!.endsWith("…"));
});
