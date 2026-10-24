import sharp from "sharp";
import { ensureFontConfig } from "../../lib/fonts.js";

/** Single choke point for rasterising creatives, so fonts are always configured first. */
export async function svgToPng(svg: Buffer | string): Promise<Buffer> {
  ensureFontConfig();
  return sharp(Buffer.isBuffer(svg) ? svg : Buffer.from(svg, "utf8"), { density: 72 }).png().toBuffer();
}

export function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const match = /^data:image\/(?:svg\+xml|png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return match ? Buffer.from(match[1]!, "base64") : null;
}

/** Visible text inside a generated SVG, used to verify the creative itself carries the phone, CTA and hashtag. */
export function svgVisibleText(svg: string): string {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map(match => match[1]!.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .join(" ").replace(/\s+/g, " ").trim();
}
