import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { chooseDesign, createBrandedAsset } from "./asset.service.js";
import type { VisualStyle } from "./content.service.js";

/**
 * Picks a layout + palette that differs from the recent posts, then renders the branded banner
 * (square for feed posts, vertical for Reel covers) and the wide 1200x630 image used by the Send Message link card.
 */
export async function buildCreativeForDraft(input: { title: string; subtitle?: string | null; caption: string; format: "POST" | "REEL"; requestedStyle?: VisualStyle }) {
  const snapshot = await prisma.pageSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { pageName: true, profilePicture: true } });
  const recent = await prisma.contentItem.findMany({ orderBy: { createdAt: "desc" }, take: 14, select: { visualStyle: true, designPalette: true } });
  const { style, palette } = chooseDesign(`${input.title}:${input.caption}:${randomUUID()}`, recent, input.requestedStyle);
  const common = { title: input.title, subtitle: input.subtitle, pageName: snapshot?.pageName || "TutorLink Tuition Media", profilePicture: snapshot?.profilePicture || null, visualStyle: style, palette };
  const assetUrl = await createBrandedAsset({ ...common, format: input.format });
  const linkAssetUrl = input.format === "POST" ? await createBrandedAsset({ ...common, format: "LINK" }) : null;
  return { visualStyle: style, designPalette: palette, assetUrl, linkAssetUrl };
}
