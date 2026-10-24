import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLeadClassification } from "../lead-classifier.rules.js";

test("lead classifier qualifies only clear guardian intent with multiple concrete details", () => {
  assert.equal(normalizeLeadClassification({ tuitionIntent: true, guardianIntent: true, relevant: true, classMentioned: true, subjectMentioned: true, confidence: 0.91, reasonBn: "শ্রেণি ও বিষয় উল্লেখ আছে" }).status, "QUALIFIED");
  assert.equal(normalizeLeadClassification({ tuitionIntent: true, guardianIntent: true, relevant: true, classMentioned: true, subjectMentioned: false, confidence: 0.99 }).status, "NEW");
  assert.equal(normalizeLeadClassification({ tuitionIntent: false, guardianIntent: false, relevant: false, confidence: 0.96 }).status, "UNQUALIFIED");
});

test("invalid or uncertain classifier output defaults to NEW", () => {
  assert.equal(normalizeLeadClassification(null).status, "NEW");
  assert.equal(normalizeLeadClassification({ tuitionIntent: true, guardianIntent: true, classMentioned: true, subjectMentioned: true, confidence: 0.4 }).status, "NEW");
});
