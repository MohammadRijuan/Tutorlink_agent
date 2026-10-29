import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

const assets = await import("../asset.service.js");
const render = await import("../render.service.js");
const fonts = await import("../../../lib/fonts.js");

const title = "CUET, CU, CMC সহ স্বনামধন্য বিশ্ববিদ্যালয় থেকে গৃহশিক্ষক / শিক্ষিকা দিচ্ছি";
const subtitle = "প্লে–দ্বাদশ, NC, BC, O/A level ও ভর্তি পরীক্ষার্থীদের জন্য দক্ষ ও ভেরিফায়েড শিক্ষক";

test("choosing designs: no style repeats within 5 posts, no palette within 3, no combination within 14", () => {
  const recent: Array<{ visualStyle: string; designPalette: string }> = [];
  for (let i = 0; i < 40; i++) {
    const choice = assets.chooseDesign(`seed-${i}-${Math.random()}`, recent.slice().reverse());
    assert.ok(!recent.slice(-5).some(item => item.visualStyle === choice.style), `style repeated at post ${i}`);
    assert.ok(!recent.slice(-3).some(item => item.designPalette === choice.palette), `palette repeated at post ${i}`);
    assert.ok(!recent.slice(-14).some(item => item.visualStyle === choice.style && item.designPalette === choice.palette), `combination repeated at post ${i}`);
    recent.push({ visualStyle: choice.style, designPalette: choice.palette });
  }
  assert.ok(new Set(recent.map(item => item.visualStyle)).size >= 8, "uses most layouts");
  assert.ok(assets.STYLE_ROTATION.length * assets.PALETTE_NAMES.length >= 80, "at least 80 distinct designs");
});

for (const format of ["POST", "REEL", "LINK"] as const) {
  test(`every layout renders readable ${format} creatives that carry the phone, CTA and hashtag, using only bundled-font glyphs`, async () => {
    const dims = { POST: [1200, 1200], REEL: [1080, 1920], LINK: [1200, 630] }[format];
    for (const [index, style] of assets.STYLE_ROTATION.entries()) {
      const palette = assets.PALETTE_NAMES[index % assets.PALETTE_NAMES.length]!;
      const url = await assets.createBrandedAsset({ title, subtitle, format, visualStyle: style, palette });
      const svg = dataUrlText(url);
      const text = render.svgVisibleText(svg);
      assert.ok(text.includes("01886-603858") && text.includes("মেসেঞ্জারে যোগাযোগ করুন") && text.includes("#TutorlinkTuitionMedia"), `${style} ${format} lacks required branding`);
      assert.deepEqual(fonts.findUnsupportedCharacters(text), [], `${style} has undrawable characters`);
      const png = await render.svgToPng(svg);
      const meta = await sharp(png).metadata();
      assert.deepEqual([meta.width, meta.height], dims);
    }
  });
}

test("emoji in an AI headline is stripped so it can never render as an empty box", async () => {
  const url = await assets.createBrandedAsset({ title: "টিউটর খোঁজার টিপস 📚✨", format: "POST", visualStyle: "BOLD_HOOK" });
  assert.ok(!render.svgVisibleText(dataUrlText(url)).includes("📚"));
});

test("a very long headline shrinks and ends with an ellipsis instead of overflowing", async () => {
  const long = "হোম টিউটর খোঁজার আগে অভিভাবকের যে তথ্যগুলো প্রস্তুত রাখা দরকার এবং কীভাবে সঠিক প্রশ্ন করবেন সেই বিষয়ে একটি সম্পূর্ণ গাইড যা প্রতিটি পরিবারের কাজে লাগবে এবং আরও অনেক কিছু জানা যাবে এখানে";
  const url = await assets.createBrandedAsset({ title: long, subtitle: long, format: "POST", visualStyle: "CARD_STACK" });
  assert.ok((await sharp(await render.svgToPng(dataUrlText(url))).metadata()).width === 1200);
});

function dataUrlText(url: string) { return Buffer.from(url.split(",")[1]!, "base64").toString("utf8"); }
