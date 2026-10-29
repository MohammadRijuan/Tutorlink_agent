import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";

process.env.META_PAGE_ACCESS_TOKEN = "EAAtoken";
const meta = await import("../meta.service.js");

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("one rejected metric no longer blanks the others, and the real Meta error is reported as a data gap", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const fields = url.searchParams.get("fields") || "";
    if (url.pathname.endsWith("/insights")) return json(200, { data: [{ name: "post_media_view", values: [{ value: 141 }] }, { name: "post_total_media_view_unique", values: [{ value: 0 }] }] });
    if (url.pathname.endsWith("/posts")) {
      if (fields.includes("reactions")) return json(400, { error: { code: 10, message: "(#10) This endpoint requires the 'pages_read_user_content' permission" } });
      if (fields.includes("comments")) return json(200, { data: [{ id: "1_1", comments: { summary: { total_count: 4 } } }] });
      if (fields.includes("shares")) return json(200, { data: [{ id: "1_1", shares: { count: 2 } }] });
      return json(200, { data: [{ id: "1_1", message: "post", created_time: "2026-10-24T00:00:00+0000" }] });
    }
    return json(200, { id: "1", name: "TutorLink", followers_count: 900 });
  }) as typeof fetch;
  try {
    const result = await meta.analyzePage();
    const post = result.posts[0]!;
    assert.equal(post.comments, 4);
    assert.equal(post.shares, 2);
    assert.equal(post.reactions, null, "unavailable is null, never zero");
    assert.equal(post.insights.post_media_view, 141);
    assert.equal(post.insights.post_total_media_view_unique, null, "impossible 0 unique viewers is treated as unavailable");
    const reactionGap = result.gaps.find(gap => gap.area === "reactions");
    assert.ok(reactionGap && reactionGap.code === 10 && /pages_read_user_content/.test(reactionGap.fix));
    assert.ok(result.gaps.some(gap => gap.area === "unique media views"));
    assert.ok(!result.gaps.some(gap => gap.area === "comments"));
  } finally { globalThis.fetch = original; }
});
