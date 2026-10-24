import { z } from "zod";
import { prisma } from "../../lib/prisma.js";

/** Trusted business configuration (FR-01). Prompts only state facts that appear here; prohibited claims are enforced on every draft. */
export const DEFAULT_PROHIBITED_CLAIMS = [
  "গ্যারান্টি", "গ্যারেন্টি", "guarantee", "১০০%", "100%", "শতভাগ নিশ্চিত", "সেরা টিউটর", "best tutor",
  "ফ্রি ডেমো", "বিনামূল্যে", "ডিসকাউন্ট", "অফার", "ছাড়",
];

export const businessProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(600),
  serviceAreas: z.array(z.string().trim().min(2).max(80)).max(40),
  supportedPrograms: z.array(z.string().trim().min(2).max(120)).max(30),
  trustedFacts: z.array(z.string().trim().min(3).max(240)).max(30),
  prohibitedClaims: z.array(z.string().trim().min(2).max(120)).max(60),
});
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

export const DEFAULT_PROFILE: BusinessProfileInput = {
  name: "TutorLink Tuition Media",
  description: "হোম টিউটর খোঁজার ক্ষেত্রে অভিভাবকদের সহায়তাকারী টিউটর ম্যাচিং সেবা।",
  serviceAreas: ["চট্টগ্রাম"],
  supportedPrograms: [],
  trustedFacts: [],
  prohibitedClaims: [],
};

const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim()) : [];

export async function getBusinessProfile(): Promise<BusinessProfileInput & { configured: boolean }> {
  const row = await prisma.businessProfile.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!row) return { ...DEFAULT_PROFILE, configured: false };
  return {
    name: row.name, description: row.description, serviceAreas: stringList(row.serviceAreas), supportedPrograms: stringList(row.supportedPrograms),
    trustedFacts: stringList(row.trustedFacts), prohibitedClaims: stringList(row.prohibitedClaims), configured: true,
  };
}

export async function saveBusinessProfile(input: BusinessProfileInput) {
  const existing = await prisma.businessProfile.findFirst({ orderBy: { updatedAt: "desc" }, select: { id: true } });
  const data = { name: input.name, description: input.description, serviceAreas: input.serviceAreas as never, supportedPrograms: input.supportedPrograms as never, trustedFacts: input.trustedFacts as never, prohibitedClaims: input.prohibitedClaims as never, brandAssetUrls: [] as never };
  if (existing) return prisma.businessProfile.update({ where: { id: existing.id }, data: { name: data.name, description: data.description, serviceAreas: data.serviceAreas, supportedPrograms: data.supportedPrograms, trustedFacts: data.trustedFacts, prohibitedClaims: data.prohibitedClaims } });
  return prisma.businessProfile.create({ data });
}

export type BusinessContext = { name: string; serviceAreas: string[]; supportedPrograms: string[]; trustedFacts: string[]; prohibitedClaims: string[] };

/** Never throws: content generation must still work (with conservative defaults) if the profile cannot be read. */
export async function loadBusinessContext(): Promise<BusinessContext> {
  try {
    const profile = await getBusinessProfile();
    return { name: profile.name, serviceAreas: profile.serviceAreas, supportedPrograms: profile.supportedPrograms, trustedFacts: profile.trustedFacts, prohibitedClaims: profile.prohibitedClaims };
  } catch {
    return { name: DEFAULT_PROFILE.name, serviceAreas: DEFAULT_PROFILE.serviceAreas, supportedPrograms: [], trustedFacts: [], prohibitedClaims: [] };
  }
}
