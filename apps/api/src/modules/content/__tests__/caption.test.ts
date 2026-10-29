import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";

const { formatCaption } = await import("../content.service.js");
const { withHashtags, buildFinalCaption } = await import("../../meta/publishing.service.js");

const dense = "চট্টগ্রামে আপনার সন্তানের জন্য হোম টিউটর খোঁজার আগে কিছু প্রস্তুতি থাকলে ভালো হয়। প্রথমত, ক্লাসের সিলেবাস দেখুন। দ্বিতীয়ত, দুর্বল বিষয়ের তালিকা করুন। তৃতীয়ত, সপ্তাহে কয় দিন পড়ানো সম্ভব তা ঠিক করুন। এই প্রস্তুতি থাকলে সঠিক মিল পাওয়া সহজ। প্রয়োজনে আজই মেসেজ করুন অথবা কল করুন 01886-603858 নম্বরে।";

test("a dense paragraph becomes hook, one numbered step per line, takeaway and contact block", () => {
  const out = formatCaption(dense);
  const lines = out.split("\n");
  assert.equal(lines.filter(line => /^[1-9]️⃣ /u.test(line)).length, 3);
  assert.ok(!out.includes("প্রথমত") && !out.includes("দ্বিতীয়ত"), "ordinal words are replaced by numbering");
  assert.ok(out.includes("\n\n"), "sections are separated by blank lines");
  assert.match(lines[lines.length - 1]!, /01886-603858/);
});

test("captions the model already structured are left untouched", () => {
  const good = "হুক লাইন\n\n1️⃣ প্রথম ধাপ\n2️⃣ দ্বিতীয় ধাপ\n3️⃣ তৃতীয় ধাপ\n\nশেষ কথা\n\n📞 01886-603858";
  assert.equal(formatCaption(good), good);
});

test("all hashtags reach the final post: required first, extras after, on one last line, no duplicates", () => {
  const body = "টিউটর খোঁজার টিপস\n\n📞 01886-603858\n\n#TutorlinkTuitionMedia";
  const out = withHashtags(body, ["#TutorlinkTuitionMedia", "#HomeTutorChittagong", "#হোমটিউটর", "bad tag"]);
  const last = out.split("\n").pop()!;
  assert.equal(last, "#TutorlinkTuitionMedia #HomeTutorChittagong #হোমটিউটর");
  assert.equal(out.match(/#TutorlinkTuitionMedia/g)?.length, 1);
});

test("link-card posts carry no raw link (the button does); photo and Reel posts keep the attributable link", () => {
  const caption = "হুক\n\nবিস্তারিত লাইন বিস্তারিত লাইন বিস্তারিত লাইন\n\n📞 01886-603858 মেসেঞ্জারে যোগাযোগ করুন #TutorlinkTuitionMedia";
  const card = buildFinalCaption(caption, "cmabcdefghij12345", { hashtags: [], includeLink: false });
  const photo = buildFinalCaption(caption, "cmabcdefghij12345", { hashtags: [] });
  assert.ok(!card.includes("m.me"));
  assert.ok(photo.includes("https://m.me/TutorLinkTest?ref=tl_cmabcdefghij12345"));
});
