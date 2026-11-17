import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../../config/env.js";
import { CREATIVE_FONT_FAMILY } from "../../lib/fonts.js";
import { runFfmpeg } from "../../lib/ffmpeg.js";
import { getPalette } from "../content/asset.service.js";
import { fitSingleLine, layoutLines } from "../content/creative.text.js";
import { svgToPng } from "../content/render.service.js";
import { REQUIRED_CTA, REQUIRED_HASHTAG, REQUIRED_PHONE } from "../content/safety.rules.js";
import { planSceneTimings } from "./audio.js";
import { gradientBackground, loadPhoto } from "./backgrounds.js";
import type { Brand } from "./brand.js";
import { captionChunks, headlineWords, type ReelPlan } from "./reel-plan.js";

const FONT = CREATIVE_FONT_FAMILY;
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LEAD_IN = 0.35;
const FPS = 25;

export type StudioVoice = { m4a: Buffer; seconds: number; pauses: number[] };
export type StudioResult = { bytes: Buffer; seconds: number; scenes: number; style: ReelPlan["style"]; voiceSeconds: number };

type Dim = { W: number; H: number; f: number };
function dims(width?: number): Dim { const W = width ?? env.REEL_WIDTH; return { W, H: Math.round((W * 16) / 9), f: W / 720 }; }
const svgOpen = ({ W, H }: Dim) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 720 1280">`;
const dataUri = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

function wordSpans(line: string, emphasis: Set<string>, accent: string, base: string) {
  return line.split(" ").map(word => `<tspan fill="${emphasis.has(word.replace(/[।,?!;:"'()]+$/u, "")) ? accent : base}">${esc(word)}</tspan>`).join(" ");
}

/** Static overlay that stays on screen through the content scenes (everything except the changing subtitles). */
async function frameLayer(style: ReelPlan["style"], plan: ReelPlan, brand: Brand, palette: ReturnType<typeof getPalette>, d: Dim): Promise<Buffer> {
  const logo = dataUri(brand.logo);
  const accent = "#FFD400";
  if (style === "EXPLAINER") {
    // Pinned two-line headline bar with a highlighted phrase, like the reference explainer.
    const words = headlineWords(plan.headline ?? "");
    const plain = words.map(item => item.word).join(" ");
    const layout = await layoutLines(plain, { maxWidth: 660, sizes: [42, 38, 34, 31, 28], maxLines: 2, weight: "ExtraBold" });
    let index = 0;
    const lines = layout.lines.map(line => line.split(" ").map(() => words[index++]));
    const lineH = Math.round(layout.fontSize * 1.38);
    const barH = 36 + lineH * lines.length + 20;
    const headlineSvg = lines.map((lineWords, row) => `<text x="360" y="${40 + layout.fontSize + row * lineH}" text-anchor="middle" font-family="${FONT}" font-size="${layout.fontSize}" font-weight="800">${lineWords.map(item => `<tspan fill="${item?.highlight ? accent : "#ffffff"}">${esc(item?.word ?? "")}</tspan>`).join(" ")}</text>`).join("");
    const phoneSize = await fitSingleLine(REQUIRED_PHONE, 620, [76, 70, 64, 58], "ExtraBold");
    const ctaSize = await fitSingleLine(REQUIRED_CTA, 600, [34, 30, 28, 24], "ExtraBold");
    const svg = `${svgOpen(d)}<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".82"/></linearGradient><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".5" stop-color="#000" stop-opacity=".38"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient><clipPath id="c"><circle cx="652" cy="${barH + 62}" r="42"/></clipPath></defs>`
      + `<rect y="560" width="720" height="460" fill="url(#m)"/><rect y="960" width="720" height="320" fill="url(#b)"/>`
      + `<rect width="720" height="${barH}" fill="#0b1f3a" fill-opacity=".95"/><rect y="${barH}" width="720" height="5" fill="${palette.accent}"/>${headlineSvg}`
      + `<circle cx="652" cy="${barH + 62}" r="46" fill="#fff"/><image href="${logo}" x="610" y="${barH + 20}" width="84" height="84" clip-path="url(#c)" preserveAspectRatio="xMidYMid slice"/>`
      + `<text x="360" y="1196" text-anchor="middle" font-family="${FONT}" font-size="${phoneSize}" font-weight="800" fill="#fff" fill-opacity=".94" stroke="#000" stroke-opacity=".55" stroke-width="7" paint-order="stroke">${REQUIRED_PHONE}</text>`
      + `<text x="360" y="1248" text-anchor="middle" font-family="${FONT}" font-size="${ctaSize}" font-weight="800" fill="${accent}" stroke="#000" stroke-opacity=".5" stroke-width="5" paint-order="stroke">${REQUIRED_CTA}</text></svg>`;
    return svgToPng(svg);
  }
  // STORY: cinematic, almost no chrome: a small brand chip and a soft vignette.
  const nameSize = await fitSingleLine(brand.pageName, 400, [30, 27, 24, 21], "ExtraBold");
  const svg = `${svgOpen(d)}<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></linearGradient><linearGradient id="t" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient><clipPath id="c"><circle cx="76" cy="84" r="34"/></clipPath></defs>`
    + `<rect width="720" height="260" fill="url(#t)"/><rect y="820" width="720" height="460" fill="url(#b)"/>`
    + `<circle cx="76" cy="84" r="38" fill="#fff"/><image href="${logo}" x="42" y="50" width="68" height="68" clip-path="url(#c)" preserveAspectRatio="xMidYMid slice"/>`
    + `<text x="128" y="${84 + Math.round(nameSize * 0.34)}" font-family="${FONT}" font-size="${nameSize}" font-weight="800" fill="#fff" stroke="#000" stroke-opacity=".5" stroke-width="5" paint-order="stroke">${esc(brand.pageName)}</text></svg>`;
  return svgToPng(svg);
}

/** One subtitle phrase, big and bold with outlined letters and highlighted key words. */
async function captionLayer(text: string, emphasis: string[], style: ReelPlan["style"], d: Dim): Promise<Buffer> {
  const explainer = style === "EXPLAINER";
  const layout = await layoutLines(text, { maxWidth: explainer ? 640 : 620, sizes: explainer ? [70, 64, 58, 52, 46] : [54, 50, 46, 42, 38], maxLines: 3, weight: "ExtraBold" });
  const lineH = Math.round(layout.fontSize * 1.3);
  const blockH = layout.lines.length * lineH;
  const top = Math.round((explainer ? 800 : 1010) - blockH / 2);
  const set = new Set(emphasis);
  const spans = layout.lines.map((line, i) => `<text x="360" y="${top + Math.round(layout.fontSize * 0.92) + i * lineH}" text-anchor="middle" font-family="${FONT}" font-size="${layout.fontSize}" font-weight="800" stroke="#000" stroke-width="${explainer ? 11 : 8}" stroke-linejoin="round" stroke-opacity=".9" paint-order="stroke">${wordSpans(line, set, "#FFD400", "#ffffff")}</text>`).join("");
  return svgToPng(`${svgOpen(d)}${spans}</svg>`);
}

/** Branded end card: logo, page name, phone number and call to action. */
async function endCardLayer(brand: Brand, palette: ReturnType<typeof getPalette>, d: Dim): Promise<Buffer> {
  const logo = dataUri(brand.logo);
  const nameLayout = await layoutLines(brand.pageName, { maxWidth: 620, sizes: [64, 58, 52, 46, 40], maxLines: 2, weight: "ExtraBold" });
  const nameLH = Math.round(nameLayout.fontSize * 1.25);
  const nameY = 600;
  const phoneSize = await fitSingleLine(REQUIRED_PHONE, 560, [78, 72, 66, 60], "ExtraBold");
  const ctaSize = await fitSingleLine(REQUIRED_CTA, 560, [38, 34, 30, 26], "ExtraBold");
  const tagSize = await fitSingleLine(REQUIRED_HASHTAG, 620, [32, 28, 24], "Bold");
  const bandY = nameY + nameLayout.lines.length * nameLH + 60;
  const nameSvg = nameLayout.lines.map((line, i) => `<text x="360" y="${nameY + i * nameLH}" text-anchor="middle" font-family="${FONT}" font-size="${nameLayout.fontSize}" font-weight="800" fill="#fff">${esc(line)}</text>`).join("");
  const svg = `${svgOpen(d)}<defs><clipPath id="c"><circle cx="360" cy="400" r="138"/></clipPath></defs>`
    + `<circle cx="360" cy="400" r="150" fill="#fff"/><image href="${logo}" x="222" y="262" width="276" height="276" clip-path="url(#c)" preserveAspectRatio="xMidYMid slice"/>${nameSvg}`
    + `<rect x="70" y="${bandY}" width="580" height="124" rx="30" fill="${palette.accent}"/><text x="360" y="${bandY + 62 + Math.round(phoneSize * 0.36)}" text-anchor="middle" font-family="${FONT}" font-size="${phoneSize}" font-weight="800" fill="${palette.deep1}">${REQUIRED_PHONE}</text>`
    + `<rect x="100" y="${bandY + 160}" width="520" height="96" rx="48" fill="#fff"/><text x="360" y="${bandY + 160 + 48 + Math.round(ctaSize * 0.34)}" text-anchor="middle" font-family="${FONT}" font-size="${ctaSize}" font-weight="800" fill="${palette.deep1}">${REQUIRED_CTA}</text>`
    + `<text x="360" y="${bandY + 330}" text-anchor="middle" font-family="${FONT}" font-size="${tagSize}" font-weight="700" fill="#fff" fill-opacity=".9">${REQUIRED_HASHTAG}</text></svg>`;
  return svgToPng(svg);
}

type SceneSpec = { index: number; start: number; duration: number; background: Buffer; frame: Buffer; captions: Array<{ png: Buffer; from: number; to: number }>; zoomIn: boolean };

/**
 * Renders the complete video: one continuous voice-over, scene changes placed on natural pauses, subtitles timed across each scene, and a final branded
 * card that outlasts the last spoken word. The video is always longer than the audio, so the voice can never be cut off.
 */
export async function renderReelVideo(input: { plan: ReelPlan; voice: StudioVoice; brand: Brand; palette: string; seed?: number; /** Lower width for dashboard previews (small enough to return from a serverless function). */ width?: number }): Promise<StudioResult> {
  const d = dims(input.width);
  const { plan, voice, brand } = input;
  const palette = getPalette(input.palette);
  const dir = await mkdtemp(join(tmpdir(), "tutorlink-studio-"));
  try {
    const sceneTexts = [...plan.scenes.map(scene => scene.narration), plan.ctaNarration];
    const { timings, total } = planSceneTimings(sceneTexts.map(text => text.length), voice.seconds, voice.pauses, { leadIn: LEAD_IN });
    const frame = await frameLayer(plan.style, plan, brand, palette, d);
    const endCard = await endCardLayer(brand, palette, d);
    const bw = Math.round(d.W * 1.2); const bh = Math.round(d.H * 1.2);

    const specs: SceneSpec[] = [];
    for (const [index, text] of sceneTexts.entries()) {
      const timing = timings[index]!; const duration = timing.end - timing.start;
      const isCta = index === sceneTexts.length - 1;
      const scene = isCta ? null : plan.scenes[index]!;
      const photo = scene ? await loadPhoto(scene.visual, index, bw, bh) : null;
      const background = photo ?? await gradientBackground(input.palette, (input.seed ?? 7) + index, bw, bh, scene?.visual);
      const captions: SceneSpec["captions"] = [];
      if (!isCta) {
        const chunks = captionChunks(text, plan.style === "EXPLAINER" ? 4 : 6);
        const weights = chunks.map(chunk => chunk.length); const sum = weights.reduce((a, b) => a + b, 0) || 1;
        const spanStart = index === 0 ? LEAD_IN : 0.1; const spanEnd = duration - 0.15; // the first scene's voice starts at LEAD_IN
        let cursor = spanStart;
        for (const [i, chunk] of chunks.entries()) {
          const slice = ((spanEnd - spanStart) * weights[i]!) / sum;
          captions.push({ png: await captionLayer(chunk, scene!.emphasis, plan.style, d), from: cursor, to: Math.min(spanEnd, cursor + slice) });
          cursor += slice;
        }
      }
      specs.push({ index, start: timing.start, duration, background, frame: isCta ? endCard : frame, captions, zoomIn: index % 2 === 0 });
    }

    const clips: string[] = [];
    for (const spec of specs) {
      const base = join(dir, `s${spec.index}`);
      await writeFile(`${base}-bg.jpg`, spec.background); await writeFile(`${base}-fr.png`, spec.frame);
      const inputs = ["-loop", "1", "-framerate", String(FPS), "-t", spec.duration.toFixed(3), "-i", `${base}-bg.jpg`, "-loop", "1", "-framerate", String(FPS), "-t", spec.duration.toFixed(3), "-i", `${base}-fr.png`];
      for (const [i, caption] of spec.captions.entries()) { await writeFile(`${base}-c${i}.png`, caption.png); inputs.push("-loop", "1", "-framerate", String(FPS), "-t", spec.duration.toFixed(3), "-i", `${base}-c${i}.png`); }
      const zoom = spec.zoomIn ? "min(1+0.0009*on,1.18)" : "max(1.18-0.0009*on,1.0)";
      const parts = [`[0:v]zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${d.W}x${d.H}:fps=${FPS},format=yuv420p[bg]`, "[bg][1:v]overlay=0:0:format=auto[v0]"];
      spec.captions.forEach((caption, i) => parts.push(`[v${i}][${i + 2}:v]overlay=0:0:format=auto:enable='between(t,${caption.from.toFixed(2)},${caption.to.toFixed(2)})'[v${i + 1}]`));
      parts.push(`[v${spec.captions.length}]fade=t=in:st=0:d=0.16,format=yuv420p[out]`);
      const out = `${base}.mp4`;
      await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-t", spec.duration.toFixed(3), "-c:v", "libx264", "-preset", "superfast", "-crf", "24", "-pix_fmt", "yuv420p", "-r", String(FPS), "-an", out], { timeoutMs: 150_000 });
      clips.push(out);
    }

    await writeFile(join(dir, "list.txt"), clips.map(clip => `file '${clip.replace(/'/g, "'\\''")}'`).join("\n"));
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-c", "copy", join(dir, "video.mp4")]);
    await writeFile(join(dir, "voice.m4a"), voice.m4a);
    // (older FFmpeg builds lack apad's whole_dur option, so pad indefinitely and cut with -t)
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", join(dir, "video.mp4"), "-i", join(dir, "voice.m4a"), "-filter_complex", `[1:a]aresample=44100,adelay=${Math.round(LEAD_IN * 1000)}|${Math.round(LEAD_IN * 1000)},apad[a]`, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-t", total.toFixed(3), "-movflags", "+faststart", join(dir, "final.mp4")]);
    const bytes = await readFile(join(dir, "final.mp4"));
    if (bytes.length < 80_000 || bytes.length > 100 * 1024 * 1024) throw new Error("The rendered video has an unexpected size.");
    return { bytes, seconds: total, scenes: specs.length, style: plan.style, voiceSeconds: voice.seconds };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
