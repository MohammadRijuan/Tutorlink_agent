import { env } from "../../config/env.js";
import { OperationError } from "../../lib/retry.js";
import { containsBanglaScript } from "../content/safety.rules.js";
import { sanitizeForCreative } from "../../lib/fonts.js";

export type ReelStyle = "STORY" | "EXPLAINER";

/** Scene imagery the agent can ask for: generic, honest visuals (no claim that the people shown are TutorLink's own tutors or students). */
export const VISUALS = {
  "struggling-child": { query: "child struggling with homework at home", label: "a child finding homework difficult" },
  "worried-parent": { query: "worried mother helping child study", label: "a worried parent helping with study" },
  "tutor-teaching": { query: "teacher explaining lesson to student at home", label: "a tutor teaching a student at home" },
  "happy-family": { query: "happy family at home child smiling", label: "a relieved, happy family" },
  "study-desk": { query: "student studying at desk with books", label: "a student studying" },
  "classroom": { query: "classroom students learning", label: "a classroom" },
  "campus": { query: "university campus building students", label: "a university campus" },
  "online-class": { query: "student online class laptop at home", label: "an online class" },
  "exam-prep": { query: "exam preparation notes desk", label: "exam preparation" },
  "books": { query: "books notebook pen desk", label: "books and notebooks" },
  "graduation": { query: "graduation cap students celebrating", label: "graduates" },
  "phone-chat": { query: "person using smartphone messaging", label: "messaging on a phone" },
} as const;
export type VisualKey = keyof typeof VISUALS;
export const VISUAL_KEYS = Object.keys(VISUALS) as VisualKey[];

export type ReelScene = { narration: string; emphasis: string[]; visual: VisualKey };
export type ReelPlan = { style: ReelStyle; headline: string | null; scenes: ReelScene[]; ctaNarration: string };

const DIGIT_WORDS = ["শূন্য", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়"];

/** "01886-603858" -> "শূন্য এক আট আট ছয়, ছয় শূন্য তিন আট পাঁচ আট": spoken digit by digit so it is always understood. */
export function phoneToSpeech(phone: string): string {
  return phone.split(/[^0-9]+/).filter(Boolean).map(group => [...group].map(digit => DIGIT_WORDS[Number(digit)]).join(" ")).join(", ");
}

export function buildCtaNarration(phone = "01886-603858"): string {
  return `আপনার সন্তানের ক্লাস, বিষয়, এলাকা আর সময় লিখে এখনই মেসেঞ্জারে মেসেজ করুন। অথবা কল করুন: ${phoneToSpeech(phone)}।`;
}

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function wordLimits(style: ReelStyle) {
  const maxWords = Math.floor(Math.max(20, env.REEL_MAX_SECONDS - 10) * 2.0); // reserve the call-to-action and tail
  return style === "STORY" ? { minScenes: 4, maxScenes: 6, minWords: 38, maxWords: Math.min(95, maxWords) } : { minScenes: 5, maxScenes: 9, minWords: 80, maxWords };
}

const bad = (message: string) => new OperationError(message, "OUTPUT_INVALID", true);
const FALLBACK_VISUALS: Record<ReelStyle, VisualKey[]> = {
  STORY: ["struggling-child", "worried-parent", "tutor-teaching", "happy-family", "study-desk", "phone-chat"],
  EXPLAINER: ["worried-parent", "study-desk", "campus", "tutor-teaching", "exam-prep", "online-class", "happy-family", "books", "phone-chat"],
};

/** Validates the AI's "reel" object. Throws OUTPUT_INVALID so the next model can try; never silently repairs missing content. */
export function validateReelPlan(raw: unknown, wanted: ReelStyle): ReelPlan {
  if (!raw || typeof raw !== "object") throw bad("The AI did not return a reel plan.");
  const input = raw as { style?: unknown; headline?: unknown; scenes?: unknown };
  const style: ReelStyle = input.style === "STORY" || input.style === "EXPLAINER" ? input.style : wanted;
  const limits = wordLimits(style);
  if (!Array.isArray(input.scenes)) throw bad("The reel plan has no scenes.");
  const scenes: ReelScene[] = [];
  for (const [index, item] of input.scenes.entries()) {
    const scene = item as { narration?: unknown; emphasis?: unknown; visual?: unknown };
    if (typeof scene.narration !== "string") continue;
    const narration = scene.narration.replace(/\s+/g, " ").trim();
    if (!containsBanglaScript(narration)) throw bad(`Scene ${index + 1} narration is not Bangla.`);
    if (countWords(narration) < 4) throw bad(`Scene ${index + 1} narration is too short to speak.`);
    if (countWords(narration) > 48) throw bad(`Scene ${index + 1} narration is too long for one scene.`);
    if (/https?:\/\/|www\./i.test(narration)) throw bad("A narration contained a link.");
    const emphasis = Array.isArray(scene.emphasis) ? scene.emphasis.filter((word): word is string => typeof word === "string" && word.trim().length > 1 && narration.includes(word.trim())).map(word => word.trim()).slice(0, 3) : [];
    const visual = typeof scene.visual === "string" && (VISUAL_KEYS as string[]).includes(scene.visual) ? scene.visual as VisualKey : FALLBACK_VISUALS[style][index % FALLBACK_VISUALS[style].length]!;
    scenes.push({ narration, emphasis, visual });
  }
  if (scenes.length < limits.minScenes || scenes.length > limits.maxScenes) throw bad(`A ${style} reel needs ${limits.minScenes}-${limits.maxScenes} scenes (got ${scenes.length}).`);
  const words = scenes.reduce((sum, scene) => sum + countWords(scene.narration), 0);
  if (words < limits.minWords) throw bad(`The narration is too short for a ${style} reel (${words} words; need ${limits.minWords}+).`);
  if (words > limits.maxWords) throw bad(`The narration is too long (${words} words; the limit is ${limits.maxWords} so the video stays under ${env.REEL_MAX_SECONDS} seconds).`);
  let headline: string | null = null;
  if (style === "EXPLAINER") {
    if (typeof input.headline !== "string" || !containsBanglaScript(input.headline)) throw bad("An explainer reel needs a Bangla headline for the pinned top bar.");
    headline = input.headline.replace(/\s+/g, " ").trim();
    if (headline.replace(/\[\[|\]\]/g, "").length > 95) throw bad("The pinned headline is too long.");
  }
  return { style, headline, scenes, ctaNarration: buildCtaNarration() };
}

export function fullNarration(plan: ReelPlan): string { return [...plan.scenes.map(scene => scene.narration), plan.ctaNarration].join(" "); }

/** Headline split into words with a highlight flag for the part wrapped in [[ ]]. */
export function headlineWords(headline: string): Array<{ word: string; highlight: boolean }> {
  const out: Array<{ word: string; highlight: boolean }> = []; let highlight = false;
  for (const token of headline.split(/(\[\[|\]\])/)) {
    if (token === "[[") { highlight = true; continue; }
    if (token === "]]") { highlight = false; continue; }
    for (const word of sanitizeForCreative(token).split(" ").filter(Boolean)) out.push({ word, highlight });
  }
  return out;
}

/** Subtitle phrases: 3 to 5 words each, broken at punctuation where possible, so they read like a presenter's rhythm. */
export function captionChunks(narration: string, maxWords = 5): string[] {
  const chunks: string[] = [];
  for (const sentence of narration.replace(/\s+/g, " ").trim().split(/(?<=[।?!,;:])\s+/)) {
    const words = sentence.split(" ").filter(Boolean);
    if (words.length <= maxWords + 1) { if (words.length) chunks.push(words.join(" ")); continue; }
    const parts = Math.ceil(words.length / maxWords); const size = Math.ceil(words.length / parts);
    for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size).join(" "));
  }
  return chunks;
}
