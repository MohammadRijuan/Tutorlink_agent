export type Classification = { status: "NEW" | "QUALIFIED" | "UNQUALIFIED"; score: number; reason: string };
export const pending = (reason = "AI qualification unavailable; review this enquiry manually."): Classification => ({ status: "NEW", score: 0, reason });

export function normalizeLeadClassification(value: unknown): Classification {
  if (!value || typeof value !== "object") return pending();
  const v = value as Record<string, unknown>;
  const scoreRaw = typeof v.confidence === "number" ? v.confidence : 0;
  const score = Math.max(0, Math.min(1, scoreRaw));
  const reason = typeof v.reasonBn === "string" ? v.reasonBn.trim().slice(0, 500) : "স্বয়ংক্রিয় প্রাথমিক যাচাই; প্রয়োজনে ম্যানুয়ালি যাচাই করুন।";
  const intent = v.tuitionIntent === true && v.guardianIntent === true && v.relevant !== false;
  const details = [v.classMentioned, v.subjectMentioned, v.areaMentioned, v.scheduleMentioned].filter(item => item === true).length;
  if (intent && details >= 2 && score >= 0.78) return { status: "QUALIFIED", score, reason };
  if (v.relevant === false && v.tuitionIntent === false && score >= 0.9) return { status: "UNQUALIFIED", score, reason };
  return { status: "NEW", score, reason };
}

