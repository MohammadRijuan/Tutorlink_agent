import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";

const { createReelFramePreview, resolveReelFrameTexts } = await import("../reel-frames.js");

test("Reel frames: hook, structured scenes and a contact end card, each carrying phone, CTA and hashtag", async () => {
  const content = { title: "সন্তানের পড়াশোনায় সহায়তা", script: null, reelScenes: ["প্রথমে সন্তানের শ্রেণি ও বিষয় বুঝুন", "সময় ও এলাকা অনুযায়ী প্রয়োজন লিখুন", "মেসেঞ্জারে প্রয়োজন জানান"] };
  const frames = await createReelFramePreview(content);
  assert.equal(frames.length, 5);
  assert.equal(new Set(frames.map(frame => frame.svg)).size, 5);
  for (const frame of frames) {
    assert.ok(frame.svg.includes("01886-603858"));
    assert.ok(frame.svg.includes("মেসেঞ্জারে যোগাযোগ করুন"));
    assert.ok(frame.svg.includes("#TutorlinkTuitionMedia"));
  }
});

test("Reel frames fall back to parsing the script for drafts created before structured scenes existed", () => {
  const texts = resolveReelFrameTexts({ title: "শিরোনাম", script: "দৃশ্য ১: প্রথমে সন্তানের শ্রেণি ও বিষয় বুঝুন\nদৃশ্য ২: সময় ও এলাকা অনুযায়ী টিউটর খুঁজুন\nদৃশ্য ৩: মেসেঞ্জারে প্রয়োজন জানান", reelScenes: null });
  assert.equal(texts.length, 5);
});
