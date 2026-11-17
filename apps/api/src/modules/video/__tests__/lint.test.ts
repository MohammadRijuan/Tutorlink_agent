import test from "node:test";
import assert from "node:assert/strict";
import { lintBangla, lintFields, similarity } from "../bangla-lint.js";

test("common misspellings are corrected automatically", () => {
  const { fixed, issues } = lintBangla("অভীভাবক পরিক্ষার্থী ভর্তী বিশ্বাবিদ্যালয় গৃহ শিক্ষক টিউটার সটিক চট্রগ্রাম");
  assert.equal(fixed, "অভিভাবক পরীক্ষার্থী ভর্তি বিশ্ববিদ্যালয় গৃহশিক্ষক টিউটর সঠিক চট্টগ্রাম"); assert.deepEqual(issues, []);
});
test("correct text passes untouched, including mixed Bangla/English phrases and the brand", () => {
  const text = "CUET, CU, CMC সহ স্বনামধন্য বিশ্ববিদ্যালয় থেকে গৃহশিক্ষক দিচ্ছি। O/A level ও ভর্তি পরীক্ষার্থী। #TutorlinkTuitionMedia";
  const { fixed, issues } = lintBangla(text); assert.equal(fixed, text); assert.deepEqual(issues, []);
});
test("structural errors are flagged so the draft can be rejected", () => {
  assert.ok(lintBangla("ািসন্তান ভালো").issues.some(issue => /vowel sign without a letter/.test(issue)));
  assert.ok(lintBangla("সন্তানtutor ভালো").issues.some(issue => /joined/.test(issue)));
  assert.ok(lintBangla("ভাললললো আছে").issues.some(issue => /repeated/.test(issue)));
  assert.ok(lintBangla("কথা বলুন।।").issues.some(issue => /punctuation/.test(issue)));
});
test("spacing and punctuation are tidied; fields and arrays are linted together", () => {
  assert.equal(lintBangla("আপনি  কেমন আছেন ?").fixed, "আপনি কেমন আছেন?");
  const result = lintFields({ title: "অভীভাবক", narrations: ["ভর্তী পরীক্ষা", "ঠিক আছে"] });
  assert.equal(result.fixed.title, "অভিভাবক"); assert.deepEqual(result.fixed.narrations, ["ভর্তি পরীক্ষা", "ঠিক আছে"]);
});
test("similarity distinguishes a correction from a rewrite", () => {
  assert.ok(similarity("অভিভাবক সন্তানের জন্য", "অভিভাবক সন্তানের জন্যে") > 0.9);
  assert.ok(similarity("আপনার সন্তানের জন্য সঠিক শিক্ষক", "সম্পূর্ণ ভিন্ন একটি বাক্য এখানে") < 0.5);
});
