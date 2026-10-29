import test from "node:test";
import assert from "node:assert/strict";
import { selectAudienceFromLeads } from "../agent-strategy.helpers.js";

test("audience signals keep Bangla vowel signs intact (গণিত must not become গণত)", () => {
  const leads = [1, 2].map(() => ({ notes: "Class: ৮ | Subject: গণিত | Area: পাঁচলাইশ", qualificationReason: "", status: "QUALIFIED" })) as never;
  const result = selectAudienceFromLeads(leads) as { topSubject?: [string, number] | null; topArea?: [string, number] | null };
  const subject = result.topSubject?.[0] ?? "";
  assert.ok(subject === "" || subject.includes("গণিত"), `subject corrupted: ${subject}`);
});
