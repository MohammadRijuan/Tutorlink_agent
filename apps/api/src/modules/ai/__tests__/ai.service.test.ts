import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";

const ai = await import("../ai.service.js");
type Call = { url: string; body: Record<string, any>; headers: Record<string, string> };

function harness(responder: (call: Call) => { status: number; json: unknown }, requestsToday = 0) {
  const calls: Call[] = [];
  const records: Array<{ ok: boolean; provider: string; category?: string }> = [];
  const restore = ai.__setAiHooks({
    requestsToday: async () => requestsToday,
    record: async (_task, attempt) => { records.push(attempt); },
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const call: Call = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")), headers: (init?.headers ?? {}) as Record<string, string> };
      calls.push(call);
      const { status, json } = responder(call);
      return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  return { calls, records, restore };
}

const okValidate = (raw: unknown) => { if (!raw || typeof (raw as { ok?: unknown }).ok !== "boolean") throw new Error("bad"); return raw as { ok: boolean }; };
const geminiOk = { candidates: [{ content: { parts: [{ text: '{"ok": true}' }] }, finishReason: "STOP" }] };
const groqOk = { choices: [{ message: { content: '{"ok": true}' }, finish_reason: "stop" }] };

test("chain parsing keeps order, drops junk and duplicates", () => {
  assert.deepEqual(ai.parseChain("gemini:a, groq:openai/gpt-oss-120b ,bogus:x,gemini:a,nocolon"), [{ provider: "gemini", model: "a" }, { provider: "groq", model: "openai/gpt-oss-120b" }]);
});

test("a Gemini quota error falls through to Groq, and the key is sent in a header (never the URL)", async () => {
  const h = harness(call => call.url.includes("googleapis")
    ? { status: 429, json: { error: { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota" } } }
    : { status: 200, json: groqOk });
  try {
    const result = await ai.generateJson({ task: "content", system: "s", prompt: "p", maxOutputTokens: 500, validate: okValidate });
    assert.equal(result.provider, "groq");
    assert.match(result.fallbackFrom ?? "", /^gemini:/);
    const gemini = h.calls.find(call => call.url.includes("googleapis"))!;
    assert.ok(!gemini.url.includes("test-gemini-key"), "API key must not appear in the URL");
    assert.equal(gemini.headers["x-goog-api-key"], "test-gemini-key");
    assert.equal(gemini.body.generationConfig.responseMimeType, "application/json");
  } finally { h.restore(); }
});

test("Groq gpt-oss requests use low reasoning effort and a generous completion limit", async () => {
  const h = harness(() => ({ status: 200, json: groqOk }));
  try {
    await ai.generateJson({ task: "content", system: "s", prompt: "p", maxOutputTokens: 3500, chain: [{ provider: "groq", model: "openai/gpt-oss-120b" }], validate: okValidate });
    const body = h.calls[0]!.body;
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.max_completion_tokens, 3500);
    assert.equal(body.response_format.type, "json_object");
  } finally { h.restore(); }
});

test("a rejected key skips that provider's remaining models; an invalid draft moves to the next model", async () => {
  const h = harness(call => call.url.includes("googleapis")
    ? { status: 400, json: { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } } }
    : { status: 200, json: { choices: [{ message: { content: '{"nope": 1}' }, finish_reason: "stop" }] } });
  try {
    await assert.rejects(ai.generateJson({ task: "content", system: "s", prompt: "p", maxOutputTokens: 500, validate: okValidate }), /Every configured free AI model failed/);
    assert.equal(h.calls.filter(call => call.url.includes("googleapis")).length, 1, "bad Gemini key is tried once, not once per model");
    assert.equal(h.calls.filter(call => call.url.includes("groq")).length, 2, "both Groq models get a chance");
  } finally { h.restore(); }
});

test("token-limit truncation is treated as an invalid answer, not success", async () => {
  const h = harness(() => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: '{"ok": tr' }] }, finishReason: "MAX_TOKENS" }] } }));
  try {
    await assert.rejects(ai.generateJson({ task: "content", system: "s", prompt: "p", maxOutputTokens: 50, chain: [{ provider: "gemini", model: "gemini-flash-latest" }], validate: okValidate }), /failed/);
    assert.equal(h.records[0]?.category, "OUTPUT_INVALID");
  } finally { h.restore(); }
});

test("Gemini thinking parts are ignored when assembling the answer", async () => {
  const h = harness(() => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text: '{"ok": true}' }] }, finishReason: "STOP" }] } }));
  try {
    const result = await ai.generateJson({ task: "content", system: "s", prompt: "p", maxOutputTokens: 500, chain: [{ provider: "gemini", model: "gemini-flash-latest" }], validate: okValidate });
    assert.equal(result.value.ok, true);
  } finally { h.restore(); }
});

test("the daily request budget stops generation before any provider is called", async () => {
  const h = harness(() => ({ status: 200, json: groqOk }), 150);
  try {
    await assert.rejects(ai.generateJson({ task: "content", system: "s", prompt: "p", maxOutputTokens: 500, validate: okValidate }), /daily AI request budget/);
    assert.equal(h.calls.length, 0);
  } finally { h.restore(); }
});

test("all-quota failure is reported as QUOTA_EXHAUSTED with nothing published", async () => {
  const h = harness(() => ({ status: 429, json: { error: { message: "Rate limit reached for model. quota" } } }));
  try {
    await assert.rejects(ai.generateJson({ task: "content", system: "s", prompt: "p", maxOutputTokens: 500, validate: okValidate }), (error: { category?: string }) => error.category === "QUOTA_EXHAUSTED");
  } finally { h.restore(); }
});
