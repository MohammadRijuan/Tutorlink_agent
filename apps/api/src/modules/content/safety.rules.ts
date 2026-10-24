export const REQUIRED_PHONE = "01886-603858";
export const REQUIRED_CTA = "মেসেঞ্জারে যোগাযোগ করুন";
export const REQUIRED_HASHTAG = "#TutorlinkTuitionMedia";
const CTA_PATTERN = /ইনবক্সে মেসেজ করুন|মেসেঞ্জারে যোগাযোগ করুন|মেসেঞ্জারে মেসেজ করুন|মেসেঞ্জারে কথা বলুন|Messenger/i;

/** Enforces the business contact and attribution hashtag on every generated caption/script. */
export function ensureRequiredBranding(text: string): string {
  let result = text.trim();
  if (!result.includes(REQUIRED_PHONE)) result += `\n\n📞 ${REQUIRED_PHONE}`;
  if (!CTA_PATTERN.test(result)) result += `\n\n${REQUIRED_CTA}।`;
  if (!result.includes(REQUIRED_HASHTAG)) result += `\n\n${REQUIRED_HASHTAG}`;
  return result;
}

export function containsBanglaScript(text: string): boolean {
  return /[\u0980-\u09FF]/u.test(text);
}

/** Share of Bangla letters among all letters, ignoring hashtags, URLs, the phone number and the brand name. */
export function banglaLetterRatio(text: string): number {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, " ").replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/01886-603858/g, " ")
    .replace(/TutorLink\s+Tuition\s+Media|Messenger|Facebook|Class|O\s*Level|A\s*Level|Cambridge|Edexcel/gi, " ");
  const letters = cleaned.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const bangla = letters.filter(char => /[\u0980-\u09FF]/u.test(char)).length;
  return bangla / letters.length;
}

const BN_DIGITS = "০-৯";
const PRICE_PATTERNS: RegExp[] = [
  new RegExp(`(?:৳|টাকা|tk\\.?|taka|bdt)\\s*[${BN_DIGITS}\\d]`, "i"),
  new RegExp(`[${BN_DIGITS}\\d][${BN_DIGITS}\\d,]*\\s*(?:৳|টাকা|tk\\b|taka|bdt)`, "i"),
];
const BUILT_IN_CLAIM_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "guarantee", pattern: /গ্যারান্টি|গ্যারেন্টি|guarantee/i },
  { id: "result-promise", pattern: /নিশ্চিত(?:ভাবে)?\s*(?:ফল|রেজাল্ট|সফল|ভালো\s*ফল|এ\+|জিপিএ)/ },
  { id: "hundred-percent", pattern: /(?:[১][০]{2}|100)\s*%|শতভাগ|শতকরা\s*(?:১০০|100)/ },
  { id: "unverified-ranking", pattern: /সেরা\s*(?:টিউটর|শিক্ষক|সার্ভিস)|best\s+tutors?|#\s*1\b|number\s*one/i },
  { id: "testimonial", pattern: /টেস্টিমোনিয়াল|testimonial|(?:অভিভাবক(?:ের|রা)?|ছাত্র(?:ছাত্রী)?)\s*(?:বলেছেন|মন্তব্য|রিভিউ)/i },
  { id: "tutor-credentials", pattern: /(?:বুয়েট|ঢাকা\s*বিশ্ববিদ্যালয়|চট্টগ্রাম\s*বিশ্ববিদ্যালয়|মেডিকেল)\s*(?:এর|র)?\s*(?:ছাত্র|শিক্ষার্থী|গ্র্যাজুয়েট)\s*টিউটর/ },
  { id: "free-offer", pattern: /ফ্রি\s*(?:ডেমো|ক্লাস|ট্রায়াল)|বিনামূল্যে|ডিসকাউন্ট|ছাড়ে/ },
];

/** Returns the ids/phrases of unsupported claims found. Empty array means the text is clean. */
export function findProhibitedClaims(text: string, extraPhrases: string[] = []): string[] {
  const hits: string[] = [];
  for (const { id, pattern } of BUILT_IN_CLAIM_PATTERNS) if (pattern.test(text)) hits.push(id);
  if (PRICE_PATTERNS.some(pattern => pattern.test(text))) hits.push("price");
  const lower = text.toLocaleLowerCase();
  for (const phrase of extraPhrases) if (phrase && lower.includes(phrase.toLocaleLowerCase())) hits.push(`phrase:${phrase}`);
  return [...new Set(hits)];
}

/** Any URL or phone number other than the verified ones must never come from the model. */
export function findForeignContactDetails(text: string): string[] {
  const problems: string[] = [];
  if (/https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|bd|me)\b/i.test(text)) problems.push("url");
  const withoutRequired = text.replace(/01886-603858/g, " ");
  if (/(?:\+?880|0)\s*1[3-9][\d\s-]{8,10}/.test(withoutRequired.replace(/[০-৯]/g, d => String("০১২৩৪৫৬৭৮৯".indexOf(d))))) problems.push("phone");
  return problems;
}

/** Safe schedule gate: only explicit opt-in, valid interval, and live mode allow autonomous publication. */
export function canSchedulePost(input: {
  automationPaused: boolean;
  agentMode: boolean;
  publishMode: "dry-run" | "live";
  hoursSinceLastPost: number | null;
  minHoursBetweenPosts: number;
}): { allowed: boolean; reason?: string } {
  if (input.automationPaused) return { allowed: false, reason: "automation-paused" };
  if (!input.agentMode) return { allowed: false, reason: "agent-mode-disabled" };
  if (input.publishMode !== "live") return { allowed: false, reason: "dry-run-mode" };
  if (input.hoursSinceLastPost !== null && input.hoursSinceLastPost < input.minHoursBetweenPosts) return { allowed: false, reason: "minimum-interval" };
  return { allowed: true };
}
