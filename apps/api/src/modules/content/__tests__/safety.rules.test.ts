import test from "node:test";
import assert from "node:assert/strict";
import { canSchedulePost, containsBanglaScript, ensureRequiredBranding, REQUIRED_CTA, REQUIRED_HASHTAG, REQUIRED_PHONE } from "../safety.rules.js";

test("branding enforcement adds the exact phone, Bangla Messenger CTA, and required hashtag", () => {
  const result = ensureRequiredBranding("সন্তানের জন্য হোম টিউটর খুঁজছেন?");
  assert.ok(result.includes(REQUIRED_PHONE));
  assert.ok(result.includes(REQUIRED_CTA));
  assert.ok(result.includes(REQUIRED_HASHTAG));
});

test("branding enforcement does not duplicate already-present requirements", () => {
  const input = `যোগাযোগ: ${REQUIRED_PHONE}\n${REQUIRED_CTA}\n${REQUIRED_HASHTAG}`;
  const result = ensureRequiredBranding(input);
  assert.equal(result.split(REQUIRED_PHONE).length - 1, 1);
  assert.equal(result.split(REQUIRED_CTA).length - 1, 1);
  assert.equal(result.split(REQUIRED_HASHTAG).length - 1, 1);
});

test("Bangla script detector distinguishes Bangla copy from English-only copy", () => {
  assert.equal(containsBanglaScript("আপনার সন্তানের জন্য টিউটর"), true);
  assert.equal(containsBanglaScript("Find a home tutor today"), false);
});

const safeDefaults = { automationPaused: false, agentMode: true, publishMode: "live" as const, hoursSinceLastPost: 30, minHoursBetweenPosts: 24 };
test("schedule gate allows a post only when all configured safety checks pass", () => {
  assert.deepEqual(canSchedulePost(safeDefaults), { allowed: true });
});
test("schedule gate blocks paused automation, dry-run, and short intervals", () => {
  assert.equal(canSchedulePost({ ...safeDefaults, automationPaused: true }).reason, "automation-paused");
  assert.equal(canSchedulePost({ ...safeDefaults, publishMode: "dry-run" }).reason, "dry-run-mode");
  assert.equal(canSchedulePost({ ...safeDefaults, hoursSinceLastPost: 4 }).reason, "minimum-interval");
  assert.equal(canSchedulePost({ ...safeDefaults, agentMode: false }).reason, "agent-mode-disabled");
});
