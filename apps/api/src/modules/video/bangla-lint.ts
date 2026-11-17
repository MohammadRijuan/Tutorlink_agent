/**
 * Deterministic Bangla checks run on EVERYTHING the agent publishes. They fix common, unambiguous mistakes automatically and flag structural
 * errors so a draft can be rejected. First of two layers; the second is an AI proofreading pass (review.service.ts).
 */
const MISSPELLINGS: Array<[string, string]> = [
  ["অভীভাবক", "অভিভাবক"], ["অভিবাবক", "অভিভাবক"], ["অভীবাবক", "অভিভাবক"], ["পরিক্ষার্থী", "পরীক্ষার্থী"], ["পরিক্ষা", "পরীক্ষা"], ["ভর্তী", "ভর্তি"],
  ["বিশ্বাবিদ্যালয়", "বিশ্ববিদ্যালয়"], ["বিশ্বিদ্যালয়", "বিশ্ববিদ্যালয়"], ["বিশ্ব বিদ্যালয়", "বিশ্ববিদ্যালয়"], ["গৃহ শিক্ষক", "গৃহশিক্ষক"], ["গৃহ শিক্ষিকা", "গৃহশিক্ষিকা"],
  ["সিক্ষক", "শিক্ষক"], ["দুঃশ্চিন্তা", "দুশ্চিন্তা"], ["মেসেন্জার", "মেসেঞ্জার"], ["টিউটার", "টিউটর"], ["সটিক", "সঠিক"], ["উপোযুক্ত", "উপযুক্ত"], ["প্রয়জন", "প্রয়োজন"],
  ["প্রয়োজণ", "প্রয়োজন"], ["চট্রগ্রাম", "চট্টগ্রাম"], ["চট্ট্গ্রাম", "চট্টগ্রাম"], ["নিশ্চীত", "নিশ্চিত"], ["শিক্ষার্থি", "শিক্ষার্থী"], ["অভীজ্ঞ", "অভিজ্ঞ"], ["সনামধন্য", "স্বনামধন্য"],
];
const DEPENDENT_VOWEL = /[\u09BE-\u09CC\u09D7]/u;
const BN = /[\u0980-\u09FF]/u;
export type LintResult = { fixed: string; issues: string[] };

export function lintBangla(input: string): LintResult {
  let text = input.normalize("NFC").replace(/[\u200B\u200E\u200F\uFEFF]/g, "").replace(/[ \t]{2,}/g, " ");
  text = text.replace(/ +([।,?!;:])/g, "$1").replace(/([।?!])(?=[\u0980-\u09FFA-Za-z])/g, "$1 ");
  for (const [wrong, right] of MISSPELLINGS) text = text.split(wrong).join(right);
  const issues: string[] = [];
  for (const rawToken of text.split(/[\s/]+/)) {
    const token = rawToken.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}\p{N}]+$/gu, "");
    if (!token || !BN.test(token)) continue;
    if (DEPENDENT_VOWEL.test(token[0]!)) issues.push(`vowel sign without a letter: ${token}`);
    if (/[\u09BE-\u09CC\u09D7]{2,}/u.test(token) && !/\u09C7\u09BE|\u09C7\u09D7/u.test(token)) issues.push(`two vowel signs in a row: ${token}`);
    if (/\u09CD$/u.test(token)) issues.push(`word ends with a hasanta: ${token}`);
    if (/(.)\1{2,}/u.test(token)) issues.push(`repeated character: ${token}`);
    if (/[\u0980-\u09FF][A-Za-z]|[A-Za-z][\u0980-\u09FF]/u.test(token)) issues.push(`Bangla and Latin letters joined in one word: ${token}`);
  }
  if (/\?\?|!!|।।|,,/.test(text)) issues.push("doubled punctuation");
  if (/[\uFFFD□]/u.test(text)) issues.push("broken character");
  return { fixed: text.trim(), issues: [...new Set(issues)] };
}

export function lintFields<T extends Record<string, string | string[] | null | undefined>>(fields: T): { fixed: T; issues: string[] } {
  const issues: string[] = []; const fixed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") { const result = lintBangla(value); fixed[key] = result.fixed; issues.push(...result.issues.map(issue => `${key}: ${issue}`)); }
    else if (Array.isArray(value)) fixed[key] = value.map((item, index) => { const result = lintBangla(String(item)); issues.push(...result.issues.map(issue => `${key}[${index}]: ${issue}`)); return result.fixed; });
    else fixed[key] = value;
  }
  return { fixed: fixed as T, issues };
}

/** 0..1 similarity (1 = identical) by edit distance over code points; ensures a proofreader only corrected, never rewrote. */
export function similarity(a: string, b: string): number {
  const x = [...a]; const y = [...b];
  if (x.length === 0 && y.length === 0) return 1;
  const max = Math.max(x.length, y.length);
  if (max > 2500) return a === b ? 1 : 0.5;
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    previous = current;
  }
  return 1 - previous[y.length]! / max;
}
