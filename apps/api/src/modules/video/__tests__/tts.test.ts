import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";

const tts = await import("../tts.service.js");
type Call = { url: string; body: any };
const pcmBase64 = (seconds: number) => Buffer.alloc(Math.round(24000 * seconds) * 2, 3).toString("base64");
function harness(responder: (call: Call, n: number) => { status: number; json: unknown }, used = 0) {
  const calls: Call[] = [];
  const restore = tts.__setTtsHooks({
    requestsToday: async () => used, record: async () => undefined, sleep: async () => undefined,
    fetchImpl: (async (url: string, init?: RequestInit) => { const call = { url: String(url), body: JSON.parse(String(init?.body)) }; calls.push(call); const r = responder(call, calls.length); return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } }); }) as typeof fetch,
  });
  return { calls, restore };
}
const ok = (seconds: number) => ({ status: 200, json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcmBase64(seconds) } }] } }] } });

test("long narration is split at sentence ends into pieces under the model's input limit, never mid-sentence", () => {
  const sentence = "এটি একটি পূর্ণ বাক্য যা কখনও মাঝপথে কাটা উচিত নয়।";
  const chunks = tts.splitForSpeech(Array(40).fill(sentence).join(" "), 900);
  assert.ok(chunks.length >= 2 && chunks.every(chunk => chunk.length <= 900 && chunk.endsWith("।")));
  assert.equal(chunks.join(" "), Array(40).fill(sentence).join(" "));
});

test("speech is requested with the chosen voice and a Bangla style instruction; the returned audio length is measured", async () => {
  const h = harness(() => ok(6));
  try {
    const speech = await tts.synthesizeSpeech("আপনার সন্তানের জন্য সঠিক শিক্ষক বেছে নিন।", { voice: "Zephyr" });
    assert.equal(speech.voice, "Zephyr"); assert.ok(Math.abs(speech.seconds - 6) < 0.01);
    assert.equal(h.calls[0]!.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Zephyr");
    assert.deepEqual(h.calls[0]!.body.generationConfig.responseModalities, ["AUDIO"]);
    assert.match(h.calls[0]!.body.contents[0].parts[0].text, /Bangla/);
  } finally { h.restore(); }
});

test("a retired or rate-limited model falls through to the next voice model", async () => {
  const h = harness(call => call.url.includes("gemini-2.5-flash-preview-tts") ? { status: 404, json: { error: { message: "model not found" } } } : ok(4));
  try { assert.notEqual((await tts.synthesizeSpeech("সংক্ষিপ্ত একটি বাক্য এখানে আছে।")).model, "gemini-2.5-flash-preview-tts"); } finally { h.restore(); }
});

test("if the voice cannot be produced the call FAILS (no half-voiced or silent result)", async () => {
  const h = harness(() => ({ status: 429, json: { error: { message: "You exceeded your current quota" } } }));
  try { await assert.rejects(tts.synthesizeSpeech("একটি বাক্য।"), (error: { name?: string; category?: string }) => error.name === "VoiceUnavailableError" && error.category === "QUOTA_EXHAUSTED"); } finally { h.restore(); }
});

test("a too-short clip is treated as a failure, and the daily voice budget is enforced before any request", async () => {
  const h = harness(() => ok(0.1));
  try { await assert.rejects(tts.synthesizeSpeech("একটি বাক্য।"), /could not be generated/); } finally { h.restore(); }
  const h2 = harness(() => ok(3), 40);
  try { await assert.rejects(tts.synthesizeSpeech("একটি বাক্য।"), /budget/); assert.equal(h2.calls.length, 0); } finally { h2.restore(); }
});
