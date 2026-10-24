import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";

const link = await import("../messenger-link.js");
const webhook = await import("../webhook.service.js");

test("caption links carry a per-post ref that round-trips back to the content id", () => {
  const id = "cmgx12345abcdefghijk";
  const url = new URL(link.messengerUrlFor(id));
  assert.equal(url.hostname, "m.me");
  assert.equal(url.pathname, "/TutorLinkTest");
  assert.equal(link.parseContentRef(url.searchParams.get("ref")), id);
});

test("foreign or malformed refs are ignored", () => {
  assert.equal(link.parseContentRef("campaign_spring"), null);
  assert.equal(link.parseContentRef("tl_"), null);
  assert.equal(link.parseContentRef("tl_../../etc"), null);
  assert.equal(link.parseContentRef(undefined), null);
});

test("Meta post/video identifiers expand to every form used for matching", () => {
  const ids = webhook.platformIdCandidates("123456789_987654321");
  assert.ok(ids.includes("123456789_987654321") && ids.includes("987654321"));
  assert.deepEqual(webhook.platformIdCandidates("555").sort(), ["123456789_555", "555"].sort());
});
