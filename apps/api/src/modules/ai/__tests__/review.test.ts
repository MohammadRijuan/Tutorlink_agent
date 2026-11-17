import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";

const ai = await import("../ai.service.js");
const { reviewDraft } = await import("../review.service.js");
const { interpretBrief, verbatimBrief, briefPromptBlock } = await import("../../agent/brief.service.js");

function mockModel(reply: (prompt: string) => { status?: number; json: unknown }) {
  return ai.__setAiHooks({
    requestsToday: async () => 0, record: async () => undefined,
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const prompt = body.contents?.[0]?.parts?.[0]?.text ?? body.messages?.[1]?.content ?? "";
      const r = reply(String(prompt)); const text = JSON.stringify(r.json);
      return new Response(JSON.stringify(r.status && r.status !== 200 ? { error: { message: "quota exceeded" } } : { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], choices: [{ message: { content: text }, finish_reason: "stop" }] }), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
}
const fields = { title: "সঠিক শিক্ষক নির্বাচন", caption: "সন্তানের জন্য সঠিক গৃহশিক্ষক বেছে নিন। 📞 01886-603858", narrations: ["আপনার সন্তানের পড়াশোনা নিয়ে কি চিন্তিত", "আমরা সাহায্য করতে পারি"] };

test("the proofreader's small corrections are applied", async () => {
  const restore = mockModel(() => ({ json: { fixed: { ...fields, narrations: ["আপনার সন্তানের পড়াশোনা নিয়ে কি চিন্তিত?", "আমরা সাহায্য করতে পারি।"] }, confidence: 0.95, compliance: [], notes: ["added punctuation"] } }));
  try {
    const out = await reviewDraft(fields, null, []);
    assert.equal(out.confident, true);
    assert.deepEqual(out.fields.narrations, ["আপনার সন্তানের পড়াশোনা নিয়ে কি চিন্তিত?", "আমরা সাহায্য করতে পারি।"]);
    assert.ok(out.corrected.includes("narrations[0]"));
  } finally { restore(); }
});

test("a 'correction' that rewrites the text is rejected: the original is kept and the draft is marked not confident", async () => {
  const restore = mockModel(() => ({ json: { fixed: { ...fields, title: "একদম নতুন ও সম্পূর্ণ ভিন্ন একটি শিরোনাম যা আগে ছিল না" }, confidence: 0.99, compliance: [], notes: [] } }));
  try { const out = await reviewDraft(fields, null, []); assert.equal(out.fields.title, fields.title); assert.equal(out.confident, false); } finally { restore(); }
});

test("low proofreader confidence, or a broken array structure, means the draft is not used", async () => {
  let restore = mockModel(() => ({ json: { fixed: fields, confidence: 0.4, compliance: [], notes: [] } }));
  try { assert.equal((await reviewDraft(fields, null, [])).confident, false); } finally { restore(); }
  restore = mockModel(() => ({ json: { fixed: { ...fields, narrations: ["একটি মাত্র"] }, confidence: 0.99, compliance: [], notes: [] } }));
  try { assert.equal((await reviewDraft(fields, null, [])).confident, false); } finally { restore(); }
});

test("owner MUST rules are checked and failures are reported with the reason", async () => {
  const brief = { ...verbatimBrief("সবসময় ভর্তি পরীক্ষার কথা বলবে"), mustDo: ["ভর্তি পরীক্ষার প্রস্তুতি উল্লেখ করা"], mustAvoid: ["দাম উল্লেখ করা"] };
  const restore = mockModel(prompt => ({ json: { fixed: fields, confidence: 0.95, compliance: [{ rule: "MUST: ভর্তি পরীক্ষার প্রস্তুতি উল্লেখ করা", ok: false, note: "admission preparation is not mentioned" }, { rule: "MUST NOT: দাম উল্লেখ করা", ok: true }], notes: prompt.includes("MUST: ভর্তি") ? ["rules were sent"] : [] } }));
  try {
    const out = await reviewDraft(fields, brief, []);
    assert.equal(out.complianceFailures.length, 1); assert.match(out.complianceFailures[0]!, /admission preparation/); assert.ok(out.notes.includes("rules were sent"));
  } finally { restore(); }
});

test("if the AI proofreader is unavailable the draft is NOT treated as proofread (default policy)", async () => {
  const restore = mockModel(() => ({ status: 429, json: {} }));
  try { const out = await reviewDraft(fields, null, []); assert.equal(out.confident, false); assert.ok(out.notes.some(note => /unavailable/.test(note))); } finally { restore(); }
});

test("deterministic fixes still apply (known misspellings) before the AI sees the text", async () => {
  let seen = "";
  const restore = mockModel(prompt => { seen = prompt; return { json: { fixed: { title: "অভিভাবক", caption: "ঠিক আছে 01886-603858", narrations: [] }, confidence: 0.9, compliance: [], notes: [] } }; });
  try {
    const out = await reviewDraft({ title: "অভীভাবক", caption: "ঠিক আছে 01886-603858", narrations: [] }, null, []);
    assert.ok(seen.includes("অভিভাবক") && !seen.includes("অভীভাবক")); assert.equal(out.fields.title, "অভিভাবক");
  } finally { restore(); }
});

test("the owner's brief is interpreted into rules, shown back, and placed at the top of prompts as mandatory", async () => {
  const restore = mockModel(() => ({ json: { summary: "The owner wants short admission-focused videos for guardians.", audience: "guardians of admission candidates", tone: "warm and confident", mustDo: ["Mention admission test preparation"], mustAvoid: ["Mention prices"], videoStyle: "EXPLAINER", focusTopics: ["ভর্তি পরীক্ষার প্রস্তুতিতে সঠিক শিক্ষক বাছাই"], doubts: ["Which admission tests?"] } }));
  try {
    const brief = await interpretBrief("ভর্তি পরীক্ষার ভিডিও বানাও, দাম বলবে না");
    assert.equal(brief.interpretedBy, "ai"); assert.deepEqual(brief.mustAvoid, ["Mention prices"]); assert.equal(brief.videoStyle, "EXPLAINER"); assert.deepEqual(brief.doubts, ["Which admission tests?"]);
    const block = briefPromptBlock(brief);
    assert.match(block, /MANDATORY/); assert.match(block, /MUST: Mention admission test preparation/); assert.match(block, /MUST NOT: Mention prices/);
  } finally { restore(); }
});

test("if the interpreter fails the owner's words are still used verbatim as a rule", async () => {
  const restore = mockModel(() => ({ status: 429, json: {} }));
  try { const brief = await interpretBrief("সবসময় ভর্তি পরীক্ষার কথা বলবে"); assert.equal(brief.interpretedBy, "verbatim"); assert.ok(brief.mustDo[0]!.includes("ভর্তি পরীক্ষার")); } finally { restore(); }
});
