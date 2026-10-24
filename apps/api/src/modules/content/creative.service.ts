import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { createBrandedAsset, resolveVisualStyle } from "./asset.service.js";
import type { VisualStyle } from "./content.service.js";

/** Picks a visual style (avoiding recent ones) and renders the branded banner / Reel cover for a draft. */
export async function buildCreativeForDraft(input: { title: string; caption: string; format: "POST" | "REEL"; requestedStyle?: VisualStyle }) {
  const snapshot = await prisma.pageSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } });
  const summary = snapshot?.rawSummary as { page?: { name?: string; picture?: string | null } } | null;
  const recentStyles = await prisma.contentItem.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { visualStyle: true } });
  const visualStyle = resolveVisualStyle(input.requestedStyle || "AUTO", `${input.title}:${input.caption}:${randomUUID()}`, recentStyles.map(item => item.visualStyle || ""));
  const assetUrl = await createBrandedAsset({
    title: input.title,
    pageName: summary?.page?.name || snapshot?.pageName || "TutorLink Tuition Media",
    profilePicture: summary?.page?.picture || snapshot?.profilePicture || null,
    format: input.format,
    visualStyle,
  });
  return { visualStyle, assetUrl };
}
