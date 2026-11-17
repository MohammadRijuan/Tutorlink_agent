import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { runFfmpeg } from "../../../lib/ffmpeg.js";

process.env.PEXELS_API_KEY = "";
const { renderReelVideo } = await import("../reel-studio.js");
const { encodeVoice, detectPauses, pcmToWav } = await import("../audio.js");
const { buildCtaNarration } = await import("../reel-plan.js");
const { svgToPng } = await import("../../content/render.service.js");

function voice(sentences: number[]) {
  const rate = 24000; const parts: Buffer[] = [];
  for (const seconds of sentences) {
    const b = Buffer.alloc(Math.round(rate * seconds) * 2);
    for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 180 * i) / rate) * (0.55 + 0.45 * Math.sin(i / 800))), i * 2);
    parts.push(b, Buffer.alloc(Math.round(rate * 0.45) * 2));
  }
  return Buffer.concat(parts.slice(0, -1));
}
const scene = (narration: string, visual = "books") => ({ narration, emphasis: [narration.split(" ")[2]!], visual });

for (const style of ["EXPLAINER", "STORY"] as const) {
  test(`a ${style} reel renders as a complete H.264 + AAC video that is longer than its voice (nothing is cut off)`, async () => {
    const pcm = voice([2.4, 2.8, 2.5, 2.6]); const seconds = pcm.length / 48000; const wav = pcmToWav(pcm);
    const logo = await svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><circle cx="160" cy="160" r="160" fill="#0b4a8f"/></svg>');
    const plan = { style, headline: style === "EXPLAINER" ? "চট্টগ্রামে [[শিক্ষক]] খুঁজছেন?" : null, ctaNarration: buildCtaNarration(), scenes: [scene("সন্তানের পড়াশোনা নিয়ে আপনি কি চিন্তিত", "worried-parent"), scene("সঠিক শিক্ষক খোঁজা সহজ নয়", "study-desk"), scene("আমরা উপযুক্ত শিক্ষক খুঁজে দিতে সাহায্য করি", "tutor-teaching")] };
    const out = await renderReelVideo({ plan: plan as never, voice: { m4a: await encodeVoice(wav), seconds, pauses: await detectPauses(wav) }, brand: { pageName: "TutorLink Tuition Media", logo }, palette: "OCEAN", width: 360 });
    assert.ok(out.seconds >= seconds + 0.35 + 1.39, "video outlasts the final spoken word");
    const { writeFile, rm } = await import("node:fs/promises"); const file = `/tmp/studio-test-${style}.mp4`;
    await writeFile(file, out.bytes);
    try {
      const { stderr } = await runFfmpeg(["-hide_banner", "-i", file, "-f", "null", "-"]);
      assert.match(stderr, /Video: h264/); assert.match(stderr, /Audio: aac/); assert.match(stderr, /360x640/);
      const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr)!; const total = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      assert.ok(Math.abs(total - out.seconds) < 0.4, `container duration ${total} vs planned ${out.seconds}`);
    } finally { await rm(file, { force: true }); }
  });
}
