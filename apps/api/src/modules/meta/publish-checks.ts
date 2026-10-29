import { loadBusinessContext } from "../business/business.service.js";
import { banglaLetterRatio, findForeignContactDetails, findProhibitedClaims, REQUIRED_CTA, REQUIRED_HASHTAG, REQUIRED_PHONE } from "../content/safety.rules.js";
import { dataUrlToBuffer, svgVisibleText } from "../content/render.service.js";
import { findUnsupportedCharacters, resolveFontsDir } from "../../lib/fonts.js";
import { messengerBaseUrl } from "./messenger-link.js";
import { env } from "../../config/env.js";
import { publicBaseUrl } from "../share.routes.js";
import { resolveReelFrameTexts } from "./reel-frames.js";

export type PublishCheck = { id: string; label: string; ok: boolean; detail?: string };
export type CheckableContent = { id: string; title: string; format: string; caption: string; script: string | null; reelScenes?: unknown; assetUrl: string | null; linkAssetUrl?: string | null };

const CTA_IN_TEXT = /মেসেঞ্জার|Messenger/i;

/** Pre-publication validation required by the project rules. Used by the publisher (blocking), dry-run previews and the dashboard. */
export async function runPublishChecks(content: CheckableContent): Promise<{ ok: boolean; checks: PublishCheck[] }> {
  const checks: PublishCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail?: string) => checks.push({ id, label, ok, ...(detail ? { detail } : {}) });

  add("caption-phone", `Caption contains ${REQUIRED_PHONE}`, content.caption.includes(REQUIRED_PHONE));
  add("caption-cta", "Caption contains a Messenger call to action", CTA_IN_TEXT.test(content.caption));
  add("caption-hashtag", `Caption contains ${REQUIRED_HASHTAG}`, content.caption.includes(REQUIRED_HASHTAG));
  const ratio = banglaLetterRatio(content.caption);
  add("language", "Caption is written mainly in Bangla", ratio >= 0.6, `${Math.round(ratio * 100)}% Bangla letters`);
  const foreign = findForeignContactDetails(`${content.title}\n${content.caption}`);
  add("contact-details", "No unverified links or phone numbers", foreign.length === 0, foreign.join(", ") || undefined);
  const business = await loadBusinessContext();
  const claims = findProhibitedClaims(`${content.title}\n${content.caption}\n${content.script ?? ""}`, business.prohibitedClaims);
  add("claims", "No prohibited claims", claims.length === 0, claims.join(", ") || undefined);

  try { messengerBaseUrl(); add("messenger-url", "Verified Messenger URL is configured", true); }
  catch (error) { add("messenger-url", "Verified Messenger URL is configured", false, error instanceof Error ? error.message : "Invalid URL"); }

  try { resolveFontsDir(); add("fonts", "Bangla fonts are available to the renderer", true); }
  catch (error) { add("fonts", "Bangla fonts are available to the renderer", false, error instanceof Error ? error.message : "Fonts missing"); }

  if (content.format === "REEL") {
    const frames = resolveReelFrameTexts(content);
    add("reel-scenes", "Reel has a hook, 3+ scenes and an end card", frames.length >= 5, `${frames.length} frames`);
    const missing = findUnsupportedCharacters(frames.join(" "));
    add("reel-glyphs", "Every Reel character can be drawn by the bundled font", missing.length === 0, missing.join(" ") || undefined);
  } else {
    const bytes = content.assetUrl ? dataUrlToBuffer(content.assetUrl) : null;
    add("creative-present", "Branded banner exists", Boolean(bytes));
    if (bytes) {
      const text = svgVisibleText(bytes.toString("utf8"));
      add("creative-phone", `Banner shows ${REQUIRED_PHONE}`, text.includes(REQUIRED_PHONE));
      add("creative-cta", "Banner shows the Messenger call to action", text.includes(REQUIRED_CTA));
      add("creative-hashtag", `Banner shows ${REQUIRED_HASHTAG}`, text.includes(REQUIRED_HASHTAG));
      const missing = findUnsupportedCharacters(text);
      add("creative-glyphs", "Every banner character can be drawn by the bundled font", missing.length === 0, missing.join(" ") || undefined);
    }
  }
  if (content.format !== "REEL") {
    const wide = content.linkAssetUrl ? dataUrlToBuffer(content.linkAssetUrl) : null;
    const base = publicBaseUrl();
    const buttonReady = env.META_POST_STYLE === "auto" && Boolean(base) && Boolean(wide);
    if (wide) {
      const text = svgVisibleText(wide.toString("utf8"));
      add("link-card-creative", "Link-card image shows phone, CTA and hashtag", text.includes(REQUIRED_PHONE) && text.includes(REQUIRED_CTA) && text.includes(REQUIRED_HASHTAG));
    }
    // Informational: never blocks publishing, because the agent safely falls back to a photo post with a Messenger link.
    add("send-message-button", buttonReady ? "Native Send Message button will be attempted" : "Photo post with Messenger link (no native button)", true,
      buttonReady ? "Link card with the Send Message button; automatic fallback to photo + link if Meta rejects it." : !base ? "Set PUBLIC_API_URL to this API's https address to enable the native button." : env.META_POST_STYLE === "photo" ? "META_POST_STYLE=photo" : "No link-card image on this draft.");
  }
  return { ok: checks.every(check => check.ok), checks };
}
