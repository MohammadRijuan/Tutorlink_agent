import test from "node:test";
import assert from "node:assert/strict";
import { createBrandedAsset, resolveVisualStyle } from "../asset.service.js";
import type { ResolvedVisualStyle } from "../content.service.js";

const styles: ResolvedVisualStyle[] = ["BOLD_HOOK", "CHECKLIST", "SPLIT_LAYOUT", "MINIMAL", "EDITORIAL", "WARM"];

test("each visual style renders a distinct SVG banner and preserves required branding", async () => {
  const rendered = await Promise.all(styles.map(async visualStyle => ({
    visualStyle,
    svg: Buffer.from((await createBrandedAsset({ title: "সন্তানের জন্য উপযুক্ত টিউটর নির্বাচন", format: "POST", visualStyle })).split(",")[1] || "", "base64").toString("utf8"),
  })));
  assert.equal(new Set(rendered.map(item => item.svg)).size, styles.length);
  for (const item of rendered) {
    assert.match(item.svg, /01886-603858/);
    assert.match(item.svg, /TutorlinkTuitionMedia/);
    assert.match(item.svg, /মেসেঞ্জারে যোগাযোগ করুন/);
  }
});

test("AUTO style resolves to one of six real templates and explicit styles remain explicit", () => {
  assert.ok(styles.includes(resolveVisualStyle("AUTO", "unique-generation-1")));
  assert.equal(resolveVisualStyle("CHECKLIST", "any-seed"), "CHECKLIST");
});

test("Reel assets use vertical dimensions while feed-post assets stay square", async () => {
  const post = Buffer.from((await createBrandedAsset({ title: "পড়াশোনার রুটিন", format: "POST", visualStyle: "MINIMAL" })).split(",")[1] || "", "base64").toString("utf8");
  const reel = Buffer.from((await createBrandedAsset({ title: "পড়াশোনার রুটিন", format: "REEL", visualStyle: "MINIMAL" })).split(",")[1] || "", "base64").toString("utf8");
  assert.match(post, /width="1200" height="1200"/);
  assert.match(reel, /width="1080" height="1920"/);
});
