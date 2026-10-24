import { prisma } from "../../lib/prisma.js";
import { CREATIVE_ANGLES, type CreativeAngle } from "./content.service.js";
import { selectAudienceFromLeads } from "./agent-strategy.helpers.js";

const metricNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : 0;

const TOPIC_BANK = [
  "চট্টগ্রামে হোম টিউটর খোঁজার আগে অভিভাবকের যে ৫টি তথ্য প্রস্তুত রাখা দরকার",
  "সন্তানের পড়ার সমস্যা বুঝতে আগে কোন প্রশ্নগুলো করবেন",
  "হোম টিউটর বাছাইয়ের সময় শুধু বিষয় নয়, সময়সূচিও কেন গুরুত্বপূর্ণ",
  "প্রথম টিউশন ক্লাসের আগে অভিভাবক ও টিউটরের মধ্যে যে বিষয়গুলো পরিষ্কার করা দরকার",
  "পরীক্ষার প্রস্তুতিকে ছোট সাপ্তাহিক লক্ষ্যে ভাগ করার উপায়",
  "গণিত বুঝতে অসুবিধা হলে বাড়িতে শেখার সহায়ক অভ্যাস",
  "বাংলা ভার্সন ও ইংলিশ ভার্সনের টিউটর খোঁজার সময় কী জানাবেন",
  "একজন উপযুক্ত হোম টিউটরের সঙ্গে পড়ার অগ্রগতি কীভাবে পর্যালোচনা করবেন",
  "চট্টগ্রামে টিউটর খোঁজার পোস্টে কোন তথ্য দিলে প্রয়োজনটি স্পষ্ট হয়",
  "সন্তানের রুটিনের সঙ্গে মানানসই টিউটর খোঁজার ব্যবহারিক চেকলিস্ট",
  "শুধু বেশি সময় নয়—পড়াশোনায় ধারাবাহিকতা তৈরির ছোট কৌশল",
  "একাধিক বিষয়ে সহায়তা দরকার হলে টিউটরের কাছে কীভাবে প্রয়োজন জানাবেন",
  "অভিভাবকের জন্য টিউটর ম্যাচিংয়ের আগে জিজ্ঞেস করার ৪টি প্রশ্ন",
  "নতুন ক্লাসে ওঠার পর পড়ার পরিকল্পনা নতুন করে সাজানোর উপায়",
  "পড়ার অগ্রগতি বোঝার জন্য নম্বর ছাড়াও কোন বিষয়গুলো দেখবেন",
  "বাসায় পড়ার সময় মনোযোগ বাড়াতে পরিবেশ ও সময় কীভাবে সাজাবেন",
  "সন্তানের শেখার ধরন বুঝে পড়ার সহায়তা বেছে নেওয়ার উপায়",
  "টিউটরের সঙ্গে নিয়মিত ফিডব্যাকের কথোপকথন কীভাবে শুরু করবেন",
  "পরীক্ষার আগের সপ্তাহে বাস্তবসম্মত রিভিশন পরিকল্পনা",
  "অভিভাবকের সাধারণ প্রশ্ন: হোম টিউটর খোঁজার সময় কোথা থেকে শুরু করব",
  "পড়ার সময়সূচি, এলাকা ও বিষয় একসঙ্গে মিলিয়ে টিউটর খোঁজার পদ্ধতি",
  "একটি ভালো টিউশন অনুরোধে যে তথ্যগুলো থাকা দরকার",
  "সন্তানের দুর্বল বিষয় চিহ্নিত করে শেখার পরিকল্পনা তৈরির সহজ উপায়",
  "হোম টিউটর বাছাইয়ের আগে পরিবারের সময় ও প্রত্যাশা কীভাবে ঠিক করবেন",
];


export type AgentContentDecision = {
  topic: string;
  format: "POST" | "REEL";
  creativeAngle: Exclude<CreativeAngle, "AUTO">;
  visualStyle: "AUTO";
  audience: string;
  goal: string;
  rationale: string;
  confidence: number;
  observation: Record<string, unknown>;
};

export async function decideNextContent(guidance = ""): Promise<AgentContentDecision> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [recent, leads, snapshots] = await Promise.all([
    prisma.contentItem.findMany({
      orderBy: { createdAt: "desc" }, take: 40,
      select: { id: true, title: true, topic: true, format: true, creativeAngle: true, visualStyle: true, status: true, createdAt: true,
        metrics: { orderBy: { observedAt: "desc" }, take: 1, select: { reach: true, uniqueMediaViews: true, impressions: true, views: true, reactions: true, comments: true, shares: true, clicks: true } },
        leads: { where: { createdAt: { gte: since } }, select: { status: true } },
      },
    }),
    prisma.lead.findMany({ where: { createdAt: { gte: since } }, select: { status: true, sourceContentId: true, serviceArea: true, classLevel: true, subjects: true } }),
    prisma.pageSnapshot.findMany({ orderBy: { fetchedAt: "desc" }, take: 2, select: { fetchedAt: true, rawSummary: true } }),
  ]);

  const qualifiedStatuses = new Set(["QUALIFIED", "BOOKED"]);
  const contentStats = recent.map(item => {
    const qualified = item.leads.filter(lead => qualifiedStatuses.has(lead.status)).length;
    const booked = item.leads.filter(lead => lead.status === "BOOKED").length;
    const metric = item.metrics[0];
    const uniqueMediaViews = metric?.uniqueMediaViews ?? 0;
    const views = metric?.views ?? 0;
    const engagement = (metric?.reactions ?? 0) + (metric?.comments ?? 0) + (metric?.shares ?? 0);
    return { format: item.format, creativeAngle: item.creativeAngle, qualified, booked, uniqueMediaViews, views, engagement, hasMetrics: Boolean(metric), status: item.status };
  });
  const attributed = leads.filter(lead => Boolean(lead.sourceContentId));
  const qualifiedRecords = leads.filter(lead => qualifiedStatuses.has(lead.status));
  const qualifiedLeads = qualifiedRecords.length;
  const bookedLeads = leads.filter(lead => lead.status === "BOOKED").length;
  const qualifiedAttributed = attributed.filter(lead => qualifiedStatuses.has(lead.status)).length;
  const { audience, topClass, topArea, topSubject } = selectAudienceFromLeads(qualifiedRecords);
  const lastFormats = recent.slice(0, 5).map(item => item.format);
  const scoreOf = (items: typeof contentStats) => items.length ? items.reduce((sum, item) => sum + item.qualified * 8 + item.booked * 7 + Math.log2(item.uniqueMediaViews + 1) * 0.25 + Math.log2(item.views + 1) * 0.15 + Math.log2(item.engagement + 1) * 0.15, 0) / items.length : 0;
  const measured = (items: typeof contentStats) => items.filter(item => item.hasMetrics || item.qualified > 0);
  const byFormat = (["POST", "REEL"] as const).map(format => {
    const samples = measured(contentStats.filter(item => item.format === format));
    return { format, samples: samples.length, score: scoreOf(samples) };
  });
  const enoughAttribution = qualifiedAttributed > 0 && byFormat.some(item => item.samples >= 3);
  let format: "POST" | "REEL";
  if (enoughAttribution && byFormat[0]!.samples >= 3 && byFormat[1]!.samples >= 3 && byFormat[0]!.score !== byFormat[1]!.score) {
    format = byFormat[0]!.score > byFormat[1]!.score ? "POST" : "REEL";
  } else if (lastFormats.length >= 2 && lastFormats[0] === lastFormats[1]) {
    format = lastFormats[0] === "POST" ? "REEL" : "POST";
  } else {
    const postCount = lastFormats.filter(value => value === "POST").length;
    const reelCount = lastFormats.filter(value => value === "REEL").length;
    format = postCount > reelCount ? "REEL" : reelCount > postCount ? "POST" : recent[0]?.format === "POST" ? "REEL" : "POST";
  }

  const recentTopics = new Set(recent.slice(0, 24).map(item => item.topic.trim().toLocaleLowerCase()));
  const leadTopics = [
    topSubject && topSubject[1] >= 2 ? `চট্টগ্রামে ${topSubject[0]} বিষয়ে সহায়তা খুঁজছেন এমন অভিভাবকের জন্য টিউটর বাছাইয়ের গাইড` : null,
    topClass && topClass[1] >= 2 ? `চট্টগ্রামে ${topClass[0]} শ্রেণির শিক্ষার্থীর জন্য টিউটর খোঁজার আগে যা জানাবেন` : null,
    topArea && topArea[1] >= 2 ? `চট্টগ্রামের ${topArea[0]} এলাকায় হোম টিউটর খোঁজার সময়সূচি ও প্রয়োজন কীভাবে মিলাবেন` : null,
  ].filter((value): value is string => Boolean(value));
  const topicVariants = [...leadTopics, ...TOPIC_BANK].flatMap(base => [
    base,
    `${base} — অভিভাবকের চেকলিস্ট`,
    `${base} — ৩ ধাপে করণীয়`,
    `${base} — সাধারণ ভুল এড়ানোর উপায়`,
    `${base} — বাস্তবসম্মত প্রশ্নোত্তর`,
  ]);
  const unseenTopics = topicVariants.filter(candidate => !recentTopics.has(candidate.toLocaleLowerCase()));
  const topic = unseenTopics[0] || `${TOPIC_BANK[recent.length % TOPIC_BANK.length]} — নতুন দৃষ্টিভঙ্গি ${recent.length + 1}`;
  const anglePool = CREATIVE_ANGLES.filter((angle): angle is Exclude<CreativeAngle, "AUTO"> => angle !== "AUTO");
  const recentAngles = recent.slice(0, 6).map(item => item.creativeAngle).filter((angle): angle is string => Boolean(angle));
  const angleStats = anglePool.map(angle => { const samples = measured(contentStats.filter(item => item.creativeAngle === angle)); return { angle, samples: samples.length, score: scoreOf(samples) }; });
  // Reuse a proven angle only with attributed evidence (2+ measured posts, positive score) and never twice in a row; otherwise rotate to explore.
  const provenAngle = enoughAttribution ? angleStats.filter(item => item.samples >= 2 && item.score > 0 && !recentAngles.slice(0, 2).includes(item.angle)).sort((a, b) => b.score - a.score)[0] : undefined;
  const creativeAngle = provenAngle?.angle || anglePool.find(angle => !recentAngles.includes(angle)) || anglePool[(recent.length % anglePool.length)] || "EDUCATIONAL_TIPS";

  const currentSnapshot = snapshots[0]?.rawSummary as { coverage?: { insightsAvailable?: number }; posts?: Array<{ insights?: Record<string, unknown> }> } | undefined;
  const insightsAvailable = currentSnapshot?.coverage?.insightsAvailable ?? 0;
  const totalUniqueMediaViews = (currentSnapshot?.posts ?? []).reduce((sum, post) => sum + metricNumber(post.insights?.post_total_media_view_unique), 0);
  const previousSummary = snapshots[1]?.rawSummary as { posts?: Array<{ insights?: Record<string, unknown> }> } | undefined;
  const previousUniqueMediaViews = (previousSummary?.posts ?? []).reduce((sum, post) => sum + metricNumber(post.insights?.post_total_media_view_unique), 0);
  const uniqueMediaViewsDropped = previousUniqueMediaViews > 0 && totalUniqueMediaViews < previousUniqueMediaViews * 0.7;
  const goal = [
    "North-star: qualified organic tuition leads and booked tuition, not likes alone.",
    `Creative audience focus selected from recent qualified lead patterns: ${audience}. This is content personalization, not a claim that organic reach can target only these people.`,
    qualifiedLeads === 0 ? "No qualified lead outcome is recorded in the last 90 days; prioritize clear high-intent tuition enquiry copy and do not claim a winner." : `${qualifiedLeads} qualified/booked leads recorded in the last 90 days; use attributed content outcomes where available.`,
    uniqueMediaViewsDropped ? "The latest saved snapshot suggests unique media views are down versus the previous snapshot; test a fresh opening hook without sacrificing lead intent." : "Use unique media views as a secondary proxy after qualified leads and bookings; exact per-post reach is unavailable in this Graph API version.",
    guidance.trim() ? `User's requested guidance (honor this in the creative): ${guidance.trim().slice(0, 1200)}` : "No extra user guidance; choose the best next topic based on lead quality, performance evidence, and anti-repetition.",
  ].join(" ");
  const evidenceAvailable = leads.length > 0 || recent.some(item => item.metrics.length > 0) || snapshots.length > 0;
  const rationale = enoughAttribution
    ? `Agent selected ${format} because it has the stronger qualified-lead/booking and unique-media-view signal in the available attributed sample. The next topic and angle are rotated to avoid recent work.`
    : `Agent selected ${format} to diversify recent formats. ${qualifiedAttributed} qualified/booked leads have source attribution; ${insightsAvailable} insight-bearing posts are in the latest Page snapshot. Until there are at least three measured items per format and reliable lead attribution, format choice is an exploration test rather than a proven winner.`;
  return {
    topic, format, creativeAngle, visualStyle: "AUTO", audience,
    goal, rationale, confidence: enoughAttribution ? 0.72 : evidenceAvailable ? 0.48 : 0.3,
    observation: {
      recentContentCount: recent.length, lastFiveFormats: lastFormats, formatScores: byFormat, angleScores: angleStats.filter(item => item.samples > 0), angleChosenByEvidence: Boolean(provenAngle),
      leadsLast90Days: leads.length, qualifiedOrBookedLeadsLast90Days: qualifiedLeads, bookedLeadsLast90Days: bookedLeads,
      qualifiedLeadsWithSourceAttribution: qualifiedAttributed, audienceSignals: { topSubject: topSubject ? { value: topSubject[0], count: topSubject[1] } : null, topClass: topClass ? { value: topClass[0], count: topClass[1] } : null, topArea: topArea ? { value: topArea[0], count: topArea[1] } : null }, latestInsightsAvailablePosts: insightsAvailable,
      latestUniqueMediaViews: totalUniqueMediaViews, previousUniqueMediaViews: previousUniqueMediaViews || null, uniqueMediaViewsDropped, guidanceProvided: Boolean(guidance.trim()),
    },
  };
}
