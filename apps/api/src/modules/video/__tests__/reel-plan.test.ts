import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { buildCtaNarration, captionChunks, countWords, headlineWords, phoneToSpeech, validateReelPlan } from "../reel-plan.js";

const s = (narration: string, visual = "books") => ({ narration, emphasis: [], visual });
const story = (n: number) => ({ style: "STORY", scenes: Array.from({ length: n }, (_, i) => s(`পড়াশোনার সময় সন্তানের মন খারাপ থাকে, এই সমস্যা ${i} নিয়ে অনেক অভিভাবক চিন্তায় থাকেন।`)) });

test("the phone number is spoken digit by digit, with a pause between the two halves", () => {
  assert.equal(phoneToSpeech("01886-603858"), "শূন্য এক আট আট ছয়, ছয় শূন্য তিন আট পাঁচ আট");
  assert.match(buildCtaNarration(), /মেসেঞ্জারে মেসেজ করুন/);
});

test("a valid story plan is accepted and always ends with the call-to-action", () => {
  const plan = validateReelPlan(story(4), "STORY");
  assert.equal(plan.scenes.length, 4);
  assert.match(plan.ctaNarration, /কল করুন/);
});

test("too few scenes, too few words, wrong language, links and over-long scenes are all rejected", () => {
  assert.throws(() => validateReelPlan(story(2), "STORY"), /scenes/);
  assert.throws(() => validateReelPlan({ style: "STORY", scenes: [s("ছোট কথা এখানে আছে"), s("ছোট কথা এখানে আছে"), s("ছোট কথা এখানে আছে"), s("ছোট কথা এখানে আছে")] }, "STORY"), /too short/);
  assert.throws(() => validateReelPlan({ style: "STORY", scenes: story(4).scenes.map((x, i) => i === 1 ? s("This scene is written in English and has enough words to count here") : x) }, "STORY"), /not Bangla/);
  assert.throws(() => validateReelPlan({ style: "STORY", scenes: story(4).scenes.map((x, i) => i === 1 ? s("বিস্তারিত দেখুন https://example.com এই ঠিকানায় গিয়ে আজকেই") : x) }, "STORY"), /link/);
  const long = "শব্দ ".repeat(60).trim();
  assert.throws(() => validateReelPlan({ style: "STORY", scenes: story(4).scenes.map((x, i) => i === 0 ? s(long) : x) }, "STORY"), /too long/);
});

test("an explainer must have a pinned headline; emphasis words that are not in the narration are dropped", () => {
  const scenes = Array.from({ length: 6 }, () => ({ narration: "আমরা আপনার সন্তানের ক্লাস, বিষয়, এলাকা ও সময় অনুযায়ী উপযুক্ত শিক্ষক খুঁজে দিতে সাহায্য করি, নিশ্চিন্তে থাকুন।", emphasis: ["উপযুক্ত", "ভুলশব্দ"], visual: "nonsense-key" }));
  assert.throws(() => validateReelPlan({ style: "EXPLAINER", scenes }, "EXPLAINER"), /headline/);
  const plan = validateReelPlan({ style: "EXPLAINER", headline: "চট্টগ্রামে [[শিক্ষক]] খুঁজছেন?", scenes }, "EXPLAINER");
  assert.deepEqual(plan.scenes[0]!.emphasis, ["উপযুক্ত"]);
  assert.ok(["struggling-child", "worried-parent", "tutor-teaching", "happy-family", "study-desk", "classroom", "campus", "online-class", "exam-prep", "books", "graduation", "phone-chat"].includes(plan.scenes[0]!.visual), "unknown visuals are replaced by a safe default");
});

test("subtitle phrases are short (3-5 words) and keep the full text", () => {
  const text = "আসসালামু আলাইকুম অভিভাবকবৃন্দ। সন্তানের জন্য সঠিক গৃহশিক্ষক খোঁজা কি কঠিন মনে হচ্ছে, আজই জানান আপনার প্রয়োজন?";
  const chunks = captionChunks(text, 5);
  assert.ok(chunks.every(chunk => countWords(chunk) <= 6));
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
});

test("the headline highlight markers are removed and the highlighted words are flagged", () => {
  const words = headlineWords("চট্টগ্রামে [[অভিজ্ঞ শিক্ষক]] খুঁজছেন?");
  assert.deepEqual(words.map(item => item.word), ["চট্টগ্রামে", "অভিজ্ঞ", "শিক্ষক", "খুঁজছেন?"]);
  assert.deepEqual(words.map(item => item.highlight), [false, true, true, false]);
});
