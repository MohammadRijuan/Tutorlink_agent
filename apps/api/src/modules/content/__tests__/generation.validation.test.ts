import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { clampAtWord, deriveScenesFromScript, isRecentDraftDuplicate, parseGeneratedJson, validateGeneratedDraft } from "../content.service.js";
import { REQUIRED_HASHTAG, REQUIRED_PHONE, REQUIRED_CTA } from "../safety.rules.js";

const post = { topic: "সঠিক টিউটর নির্বাচন", format: "POST" as const };
const reel = { topic: "সঠিক টিউটর নির্বাচন", format: "REEL" as const, reelStyle: "EXPLAINER" as const };
const caption = "হোম টিউটর খোঁজার আগে সন্তানের শ্রেণি, বিষয়, এলাকা ও সুবিধাজনক সময় গুছিয়ে নিন। পরিষ্কার তথ্য দিলে প্রয়োজন অনুযায়ী উপযুক্ত টিউটর খোঁজার আলোচনা সহজ হয়। সপ্তাহে কয় দিন পড়ানো লাগবে এবং কোন বিষয়ে সবচেয়ে বেশি সহায়তা দরকার, তা আগেই লিখে রাখুন।";
const validDraft = { title: "সঠিক টিউটর নির্বাচন", caption, hashtags: ["#HomeTutor"], script: null, scenes: [] };
const scene = (narration: string, visual = "study-desk") => ({ narration, emphasis: [], visual });
const validReel = { ...validDraft, reel: { style: "EXPLAINER", headline: "চট্টগ্রামে [[উপযুক্ত গৃহশিক্ষক]] খুঁজছেন?", scenes: [
  scene("আসসালামু আলাইকুম অভিভাবকবৃন্দ। সন্তানের জন্য সঠিক গৃহশিক্ষক খোঁজা কি আপনার কাছে কঠিন মনে হচ্ছে?", "worried-parent"),
  scene("অনেক বিজ্ঞাপন আর মানুষের ভিড়ে ভুল সিদ্ধান্ত নেওয়ার ভয় থাকে, তাই ভেবেচিন্তে এগোনো দরকার।"),
  scene("আমরা আপনার সন্তানের ক্লাস, বিষয়, এলাকা ও সময় অনুযায়ী উপযুক্ত শিক্ষক খুঁজে পেতে সাহায্য করি।", "tutor-teaching"),
  scene("প্লে থেকে দ্বাদশ শ্রেণি এবং ভর্তি পরীক্ষার প্রস্তুতির জন্য আলাদা আলাদা শিক্ষক খোঁজার সুযোগ আছে।", "exam-prep"),
  scene("আপনি শুধু মেসেঞ্জারে ক্লাস, বিষয়, এলাকা আর সময় জানাবেন, তারপর আমরা আপনার সঙ্গে কথা বলব।", "phone-chat"),
  scene("এভাবেই সন্তানের জন্য নিশ্চিন্তে একজন উপযুক্ত শিক্ষক বেছে নেওয়া অনেক সহজ হয়ে যায়।", "happy-family"),
] } };

test("generated content is validated and required TutorLink branding is enforced", () => {
  const result = validateGeneratedDraft(reel, validReel);
  assert.ok(result.caption.includes(REQUIRED_PHONE));
  assert.ok(result.caption.includes(REQUIRED_CTA));
  assert.ok(result.hashtags.includes(REQUIRED_HASHTAG));
  assert.ok(result.script?.includes(REQUIRED_PHONE));
  assert.equal(result.reelScenes?.length, 6);
  assert.equal(result.reelPlan?.style, "EXPLAINER");
  assert.ok(result.narration?.includes("শূন্য এক আট আট ছয়"), "the phone number is spoken digit by digit");
});

test("generation output without Bangla, a Reel script or enough scenes is rejected so the next model can try", () => {
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, caption: "English only caption that is long enough to pass the length rule but has no Bangla at all in it." }), /Bangla/);
  assert.throws(() => validateGeneratedDraft(reel, { ...validReel, reel: null }), /reel plan/);
  assert.throws(() => validateGeneratedDraft(reel, { ...validReel, reel: { ...validReel.reel, scenes: validReel.reel.scenes.slice(0, 2) } }), /scenes/);
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, title: "English headline" }), /headline/);
});

test("mostly-English captions and too-short captions are rejected", () => {
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, caption: "Find a good home tutor for your child in Chattogram today with proper planning for class subject area and schedule. টিউটর" }), /mainly in Bangla/);
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, caption: "টিউটর খুঁজুন।" }), /too short/);
});

test("invented links, phone numbers, prices and guarantees are rejected", () => {
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, caption: `${caption} বিস্তারিত: https://example.com/tutor` }), /contact details/);
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, caption: `${caption} কল করুন 01712345678` }), /contact details/);
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, caption: `${caption} মাত্র ৫০০ টাকায় টিউটর।` }), /unsupported claims/);
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, caption: `${caption} ভালো ফলাফলের গ্যারান্টি।` }), /unsupported claims/);
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, caption: `${caption} আমরা সেরা টিউটর দিই।` }), /unsupported claims/);
});

test("operator-defined prohibited claims from the business profile are enforced", () => {
  assert.throws(() => validateGeneratedDraft(post, { ...validDraft, caption: `${caption} আমাদের বিশেষ প্যাকেজ আছে।` }, { prohibitedClaims: ["বিশেষ প্যাকেজ"] }), /unsupported claims/);
  assert.ok(validateGeneratedDraft(post, validDraft, { prohibitedClaims: ["বিশেষ প্যাকেজ"] }));
});

test("clampAtWord never cuts inside a word and scenes can be derived from older scripts", () => {
  const clamped = clampAtWord("সন্তানের জন্য উপযুক্ত হোম টিউটর খোঁজার আগে যা জানা দরকার এবং কীভাবে শুরু করবেন", 40);
  assert.ok(clamped.length <= 41 && clamped.endsWith("…"));
  assert.equal(deriveScenesFromScript("দৃশ্য ১ (০–৪ সেকেন্ড): সন্তানের পড়ার সমস্যা বুঝুন\nদৃশ্য ২: সময় ও এলাকা ঠিক করুন").length, 2);
});

test("structured JSON parsing accepts plain and fenced provider responses", () => {
  assert.deepEqual(parseGeneratedJson('{"title":"draft"}'), { title: "draft" });
  assert.deepEqual(parseGeneratedJson('```json\n{"title":"draft"}\n```'), { title: "draft" });
  assert.throws(() => parseGeneratedJson("not JSON"), /invalid structured output/i);
});

test("recent-draft guard rejects a repeated title or caption but allows a distinct draft", () => {
  const recent = [{ title: "সঠিক টিউটর নির্বাচন", topic: "টিউটর", format: "POST", caption: "সন্তানের পড়াশোনায় সহায়তা নিন এবং প্রয়োজন জানিয়ে মেসেঞ্জারে যোগাযোগ করুন 01886-603858" }];
  assert.equal(isRecentDraftDuplicate({ title: "সঠিক টিউটর নির্বাচন", caption: "একেবারে নতুন লেখা" }, recent), true);
  assert.equal(isRecentDraftDuplicate({ title: "নতুন প্রশ্ন", caption: recent[0]!.caption }, recent), true);
  assert.equal(isRecentDraftDuplicate({ title: "নতুন প্রশ্ন", caption: "একেবারে আলাদা পরামর্শ" }, recent), false);
});


test("recent-draft guard catches near-identical hooks and titles, not only byte-for-byte copies", () => {
  const recent = [{ title: "Tutor selection checklist for guardians", topic: "Tutor selection", format: "POST", caption: "Before choosing a tutor, list the subjects, class, area, schedule and learning needs clearly. This helps the family describe the tuition request with enough detail for a useful match. 01886-603858" }];
  assert.equal(isRecentDraftDuplicate({ title: "Tutor selection checklist for guardians today", caption: "A completely different educational insight with new steps and a distinct opening hook for families. 01886-603858" }, recent), true);
  assert.equal(isRecentDraftDuplicate({ title: "A fresh exam revision routine", caption: "Break a large syllabus into small study sessions, add short breaks and review mistakes after practice. Use a realistic schedule that fits your child. 01886-603858" }, recent), false);
});


test("agent audience selection uses repeated qualified-lead subject signals and ignores unique noise", async () => {
  const { selectAudienceFromLeads } = await import("../agent-strategy.helpers.js");
  const selected = selectAudienceFromLeads([
    { classLevel: "Class 8", serviceArea: "Panchlaish", subjects: ["Mathematics", "English"] },
    { classLevel: "Class 8", serviceArea: "Panchlaish", subjects: ["Mathematics"] },
    { classLevel: "Class 6", serviceArea: "Agrabad", subjects: ["Science"] },
  ]);
  assert.match(selected.audience, /Mathematics/);
  assert.equal(selected.topSubject?.[1], 2);
  const broad = selectAudienceFromLeads([{ classLevel: "Class 8", subjects: ["Math"] }]);
  assert.match(broad.audience, /চট্টগ্রামের অভিভাবক/);
});
