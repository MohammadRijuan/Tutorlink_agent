export function selectAudienceFromLeads(records: Array<{ classLevel?: string | null; serviceArea?: string | null; subjects?: unknown }>) {
  const cleanSegment = (value: unknown) => typeof value === "string" ? value.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 50) : "";
  const mostCommon = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const raw of values) { const value = cleanSegment(raw); if (value.length >= 2) counts.set(value, (counts.get(value) || 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  };
  const topClass = mostCommon(records.map(lead => lead.classLevel || ""));
  const topArea = mostCommon(records.map(lead => lead.serviceArea || ""));
  const topSubject = mostCommon(records.flatMap(lead => Array.isArray(lead.subjects) ? lead.subjects.filter((value): value is string => typeof value === "string") : []));
  let audience = "চট্টগ্রামের অভিভাবক যারা বাস্তবসম্মত হোম টিউটর খুঁজছেন";
  if (topSubject && topSubject[1] >= 2) audience = `চট্টগ্রামে ${topSubject[0]} বিষয়ে সহায়তা খুঁজছেন এমন শিক্ষার্থীর অভিভাবক`;
  else if (topClass && topClass[1] >= 2) audience = `চট্টগ্রামে ${topClass[0]} শ্রেণির শিক্ষার্থীর অভিভাবক`;
  else if (topArea && topArea[1] >= 2) audience = `চট্টগ্রামের ${topArea[0]} এলাকায় হোম টিউটর খুঁজছেন এমন অভিভাবক`;
  return { audience, topClass, topArea, topSubject };
}

