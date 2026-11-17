import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { startOfDhakaDay } from "../../lib/dates.js";
import { classifyFailure, classifyProviderFailure, OperationError, retryAfterMs } from "../../lib/retry.js";

/** Voices offered in Settings (Gemini prebuilt voices; all speak Bangla). The owner picks one by listening to a sample. */
export const VOICES: Array<{ name: string; label: string }> = [
  { name: "Kore", label: "Kore: firm, confident" }, { name: "Puck", label: "Puck: upbeat, lively" }, { name: "Charon", label: "Charon: informative, steady" },
  { name: "Fenrir", label: "Fenrir: excitable, energetic" }, { name: "Leda", label: "Leda: youthful, friendly" }, { name: "Orus", label: "Orus: firm, authoritative" },
  { name: "Aoede", label: "Aoede: breezy, light" }, { name: "Zephyr", label: "Zephyr: bright, clear" }, { name: "Sulafat", label: "Sulafat: warm" },
  { name: "Achird", label: "Achird: friendly" }, { name: "Gacrux", label: "Gacrux: mature, calm" }, { name: "Algieba", label: "Algieba: smooth" }, { name: "Sadaltager", label: "Sadaltager: knowledgeable" },
];

export class VoiceUnavailableError extends OperationError {
  constructor(message: string, category: ConstructorParameters<typeof OperationError>[1] = "PROVIDER_UNAVAILABLE", retryable = false) { super(message, category, retryable); this.name = "VoiceUnavailableError"; }
}

type Hooks = { fetchImpl: typeof fetch; record: (ok: boolean, detail: Record<string, unknown>) => Promise<void>; requestsToday: () => Promise<number>; sleep: (ms: number) => Promise<void> };
const hooks: Hooks = {
  fetchImpl: (...args) => fetch(...args),
  record: async (ok, detail) => { try { await prisma.auditEvent.create({ data: { actor: "tts-service", action: "TTS_REQUEST", details: { ok, ...detail } as never } }); } catch { /* usage logging must never break content creation */ } },
  requestsToday: () => prisma.auditEvent.count({ where: { action: "TTS_REQUEST", createdAt: { gte: startOfDhakaDay() } } }),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};
/** Test seam. Returns a restore function. */
export function __setTtsHooks(overrides: Partial<Hooks>) { const previous = { ...hooks }; Object.assign(hooks, overrides); return () => Object.assign(hooks, previous); }

export function ttsConfigured() { return env.AI_PROVIDER !== "template" && Boolean(env.GEMINI_API_KEY); }

export async function getSelectedVoice(): Promise<string> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: "reelVoice" } });
    if (typeof row?.value === "string" && VOICES.some(voice => voice.name === row.value)) return row.value;
  } catch { /* fall back to the configured default */ }
  return VOICES.some(voice => voice.name === env.TTS_VOICE) ? env.TTS_VOICE : "Kore";
}

export async function getTtsUsage() { const used = await hooks.requestsToday().catch(() => null); return { usedToday: used, dailyLimit: env.TTS_DAILY_LIMIT }; }

/** Splits a script at sentence ends into pieces the speech model accepts (input limit about 4,000 bytes; Bangla letters take 3). */
export function splitForSpeech(text: string, maxChars = 900): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[।?!])\s+/).filter(Boolean);
  const chunks: string[] = []; let current = "";
  for (const sentence of sentences) {
    if (current && (current + " " + sentence).length > maxChars) { chunks.push(current); current = sentence; }
    else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

export const SPEECH_SAMPLE_RATE = 24000;
const parseRate = (mime: string | undefined) => { const match = /rate=(\d+)/.exec(mime || ""); return match ? Number(match[1]) : SPEECH_SAMPLE_RATE; };

async function synthesizeChunk(model: string, voice: string, text: string): Promise<Buffer> {
  const instruction = env.TTS_STYLE.trim().replace(/[.:\s]+$/, "");
  let response: Response;
  try {
    response = await hooks.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${instruction}:\n${text}` }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
      signal: AbortSignal.timeout(env.TTS_TIMEOUT_MS),
    });
  } catch (error) { throw classifyFailure(error); }
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string; status?: string; details?: Array<{ retryDelay?: string }> }; candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> };
  if (!response.ok) {
    const providerDelay = payload.error?.details?.map(detail => retryAfterMs(detail.retryDelay)).find(delay => delay !== undefined);
    const message = `${payload.error?.status || ""} ${payload.error?.message || ""}`;
    if (response.status === 400 && /api key|API_KEY_INVALID/i.test(message)) throw new OperationError("The Gemini API key was rejected.", "AUTHENTICATION", false);
    throw classifyProviderFailure(response.status, message, retryAfterMs(response.headers.get("retry-after")) ?? providerDelay);
  }
  const inline = payload.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new OperationError("The speech model returned no audio.", "OUTPUT_INVALID", true);
  const pcm = Buffer.from(inline.data, "base64");
  if (parseRate(inline.mimeType) !== SPEECH_SAMPLE_RATE) throw new OperationError(`Unexpected audio format (${inline.mimeType}).`, "OUTPUT_INVALID", false);
  if (pcm.length < SPEECH_SAMPLE_RATE * 2 * 0.4) throw new OperationError("The speech model returned an unusably short clip.", "OUTPUT_INVALID", true);
  return pcm;
}

export type Speech = { pcm: Buffer; seconds: number; voice: string; model: string; requests: number };

/**
 * Turns the whole narration into one continuous 24 kHz mono PCM track. Long scripts are split at sentence ends and joined with a short pause.
 * Nothing is ever truncated: if any piece cannot be produced the whole call fails, and the agent publishes something else instead of a half-voiced video.
 */
export async function synthesizeSpeech(text: string, options: { voice?: string } = {}): Promise<Speech> {
  if (!ttsConfigured()) throw new VoiceUnavailableError("Voice-over needs GEMINI_API_KEY (a free Google AI Studio key).", "CONFIGURATION");
  const used = await hooks.requestsToday();
  const chunks = splitForSpeech(text);
  if (chunks.length === 0) throw new VoiceUnavailableError("There is no narration to speak.", "VALIDATION");
  if (used + chunks.length > env.TTS_DAILY_LIMIT) throw new VoiceUnavailableError(`The daily voice-over budget (${env.TTS_DAILY_LIMIT}) is used up. It resets at midnight Bangladesh time.`, "QUOTA_EXHAUSTED");
  const voice = options.voice || await getSelectedVoice();
  const models = env.TTS_MODELS.split(",").map(item => item.trim()).filter(Boolean);
  const gap = Buffer.alloc(Math.round(SPEECH_SAMPLE_RATE * 0.28) * 2);
  const parts: Buffer[] = []; let usedModel = models[0] ?? ""; let requests = 0;
  for (const [index, chunk] of chunks.entries()) {
    let audio: Buffer | null = null; let lastError: OperationError | null = null;
    for (const model of models) {
      for (let attempt = 0; attempt < 2 && !audio; attempt++) {
        requests++;
        try { audio = await synthesizeChunk(model, voice, chunk); usedModel = model; await hooks.record(true, { model, voice, chars: chunk.length }); }
        catch (error) {
          lastError = classifyFailure(error);
          await hooks.record(false, { model, voice, category: lastError.category });
          if (lastError.category === "AUTHENTICATION") throw new VoiceUnavailableError(lastError.message, "AUTHENTICATION");
          if (["QUOTA_EXHAUSTED", "CONFIGURATION", "VALIDATION", "PERMISSION_DENIED"].includes(lastError.category)) break;
          if (lastError.category === "RATE_LIMITED" && (lastError.retryAfterMs ?? 0) > 0 && (lastError.retryAfterMs ?? 0) <= 45_000) await hooks.sleep(lastError.retryAfterMs!);
        }
      }
      if (audio) break;
    }
    if (!audio) throw new VoiceUnavailableError(`The voice-over could not be generated (${lastError?.category ?? "unknown"}). Nothing was published.`, lastError?.category === "QUOTA_EXHAUSTED" ? "QUOTA_EXHAUSTED" : "PROVIDER_UNAVAILABLE", lastError?.retryable ?? false);
    if (index > 0) parts.push(gap);
    parts.push(audio);
  }
  const pcm = Buffer.concat(parts);
  return { pcm, seconds: pcm.length / (SPEECH_SAMPLE_RATE * 2), voice, model: usedModel, requests };
}
