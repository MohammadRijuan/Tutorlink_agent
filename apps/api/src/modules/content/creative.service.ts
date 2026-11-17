import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { chooseDesign, createBrandedAsset } from "./asset.service.js";
import type { ValidatedDraft, VisualStyle } from "./content.service.js";
import { createVoiceForPlan, type ReelVoice } from "../video/voice.js";
import { ttsConfigured, VoiceUnavailableError } from "../video/tts.service.js";

/**
 * Picks a layout + palette that differs from the recent posts, renders the branded banner (square for feed posts, vertical for Reel covers)
 * and the wide 1200x630 image used by the Send Message link card. For Reels it also records the complete voice-over.
 */
export async function buildCreativeForDraft(input: { title: string; subtitle?: string | null; caption: string; format: "POST" | "REEL"; requestedStyle?: VisualStyle; draft?: ValidatedDraft }) {
  const snapshot = await prisma.pageSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { pageName: true, profilePicture: true } });
  const recent = await prisma.contentItem.findMany({ orderBy: { createdAt: "desc" }, take: 14, select: { visualStyle: true, designPalette: true } });
  const { style, palette } = chooseDesign(`${input.title}:${input.caption}:${randomUUID()}`, recent, input.requestedStyle);
  const common = { title: input.title, subtitle: input.subtitle, pageName: snapshot?.pageName || "TutorLink Tuition Media", profilePicture: snapshot?.profilePicture || null, visualStyle: style, palette };
  let voice: ReelVoice | null = null;
  if (input.format === "REEL" && input.draft?.reelPlan) {
    if (env.REEL_REQUIRE_VOICE === "true" || ttsConfigured()) voice = await createVoiceForPlan(input.draft.reelPlan);
    if (!voice && env.REEL_REQUIRE_VOICE === "true") throw new VoiceUnavailableError("A Reel needs its voice-over.", "CONFIGURATION");
  }
  const assetUrl = await createBrandedAsset({ ...common, format: input.format });
  const linkAssetUrl = input.format === "POST" ? await createBrandedAsset({ ...common, format: "LINK" }) : null;
  return { visualStyle: style, designPalette: palette, assetUrl, linkAssetUrl, voice };
}

/** Every database column a generated draft fills in, in one place so no creation path forgets one. */
export function draftColumns(draft: ValidatedDraft, creative: Awaited<ReturnType<typeof buildCreativeForDraft>>) {
  const json = (value: unknown) => value as never;
  return {
    title: draft.title, subtitle: draft.subtitle, caption: draft.caption, hashtags: json(draft.hashtags), script: draft.script,
    reelScenes: draft.reelScenes ? json(draft.reelScenes) : undefined, narration: draft.narration, reelPlan: draft.reelPlan ? json(draft.reelPlan) : undefined,
    visualStyle: creative.visualStyle, designPalette: creative.designPalette, assetUrl: creative.assetUrl, linkAssetUrl: creative.linkAssetUrl,
    ...(creative.voice ? { voiceAudio: new Uint8Array(creative.voice.audio), voiceSeconds: creative.voice.seconds, voicePauses: json(creative.voice.pauses), voiceName: creative.voice.voice } : {}),
    callToAction: "মেসেঞ্জারে যোগাযোগ করুন", language: "bn",
  };
}
