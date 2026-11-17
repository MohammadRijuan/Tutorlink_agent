import { env } from "../../config/env.js";
import { OperationError } from "../../lib/retry.js";
import { generateJson } from "./ai.service.js";
import { lintFields, similarity } from "../video/bangla-lint.js";
import type { Brief } from "../agent/brief.service.js";

export type ReviewFields = Record<string, string | string[]>;
export type ReviewOutcome = { fields: ReviewFields; confident: boolean; complianceFailures: string[]; corrected: string[]; notes: string[] };

/**
 * Second, independent pass over everything that will be shown or spoken: an AI Bangla editor fixes spelling, grammar and punctuation (it may only
 * correct, never rewrite) and checks the draft against the owner's brief. A draft that is structurally wrong or ignores a MUST rule is reported so the
 * caller regenerates instead of publishing it.
 */
export async function reviewDraft(fields: ReviewFields, brief: Brief | null, facts: string[]): Promise<ReviewOutcome> {
  const linted = lintFields(fields as Record<string, string | string[]>);
  const rules = brief ? [...brief.mustDo.map(item => `MUST: ${item}`), ...brief.mustAvoid.map(item => `MUST NOT: ${item}`)] : [];
  const keys = Object.keys(linted.fixed);
  let confident = true; const notes: string[] = []; const corrected: string[] = []; const complianceFailures: string[] = [];
  let current: ReviewFields = linted.fixed;
  try {
    const result = await generateJson({
      task: "content", maxOutputTokens: 4000, temperature: 0,
      system: "You are a meticulous proofreader of Bangla (Bangladesh standard, চলিত ভাষা). You correct spelling, grammar, punctuation and awkward wording WITHOUT changing the meaning, adding facts or making anything longer. You return only JSON.",
      prompt: `Proofread every field below. The text will be printed on banners, shown as video subtitles and spoken by a voice, so there must be NO spelling mistake. Keep brand names, English words, numbers and phone numbers exactly as written. Do not add claims. Keep each array the same length.\n${rules.length ? `Then check the draft against these owner rules and report each one:\n${rules.join("\n")}\n` : ""}Verified business facts (the only facts the draft may state): ${facts.join(" | ") || "none"}\n\nFIELDS (JSON):\n${JSON.stringify(linted.fixed)}\n\nReturn JSON: {"fixed": <same keys, corrected>, "confidence": <0..1, how sure you are the text is now free of errors>, "compliance": [{"rule": "<rule text>", "ok": true|false, "note": "<short reason if false>"}], "notes": ["short list of what you corrected"]}`,
      validate: raw => {
        const value = raw as { fixed?: Record<string, unknown>; confidence?: unknown; compliance?: unknown; notes?: unknown } | null;
        if (!value?.fixed || typeof value.fixed !== "object") throw new OperationError("The proofreader returned no corrected text.", "OUTPUT_INVALID", true);
        const out: ReviewFields = {};
        for (const key of keys) {
          const original = linted.fixed[key]; const candidate = value.fixed[key];
          if (Array.isArray(original)) { if (!Array.isArray(candidate) || candidate.length !== original.length || candidate.some(item => typeof item !== "string")) throw new OperationError(`The proofreader changed the structure of ${key}.`, "OUTPUT_INVALID", true); out[key] = candidate as string[]; }
          else { if (typeof candidate !== "string") throw new OperationError(`The proofreader dropped ${key}.`, "OUTPUT_INVALID", true); out[key] = candidate; }
        }
        return { fixed: out, confidence: typeof value.confidence === "number" ? value.confidence : 0.5, compliance: Array.isArray(value.compliance) ? value.compliance as Array<{ rule?: string; ok?: boolean; note?: string }> : [], notes: Array.isArray(value.notes) ? value.notes.filter((n): n is string => typeof n === "string").slice(0, 8) : [] };
      },
    });
    // Accept a corrected field only if it is still essentially the same text.
    const merged: ReviewFields = {};
    for (const key of keys) {
      const original = linted.fixed[key]; const candidate = result.value.fixed[key]!;
      if (Array.isArray(original)) merged[key] = (original as string[]).map((item, index) => { const next = (candidate as string[])[index]!; const ok = similarity(item, next) >= 0.72; if (ok && next !== item) corrected.push(`${key}[${index}]`); if (!ok) confident = false; return ok ? next : item; });
      else { const next = candidate as string; const ok = similarity(original as string, next) >= 0.72; if (ok && next !== original) corrected.push(key); if (!ok) confident = false; merged[key] = ok ? next : (original as string); }
    }
    current = lintFields(merged as Record<string, string | string[]>).fixed;
    if (result.value.confidence < 0.7) confident = false;
    notes.push(...result.value.notes);
    for (const item of result.value.compliance) if (item && item.ok === false && typeof item.rule === "string" && item.rule.startsWith("MUST")) complianceFailures.push(`${item.rule}${item.note ? ` (${item.note})` : ""}`.slice(0, 260));
  } catch {
    notes.push("AI proofreading was unavailable; only the built-in spelling checks ran.");
    if (env.REQUIRE_PROOFREAD === "true") confident = false; // never publish text that has not been proofread
  }
  const finalLint = lintFields(current as Record<string, string | string[]>);
  if (finalLint.issues.length > 0) { confident = false; notes.push(...finalLint.issues.slice(0, 5)); }
  return { fields: finalLint.fixed, confident, complianceFailures, corrected, notes };
}
