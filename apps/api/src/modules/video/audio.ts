import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "../../lib/ffmpeg.js";
import { SPEECH_SAMPLE_RATE } from "./tts.service.js";

export function pcmToWav(pcm: Buffer, rate = SPEECH_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "tutorlink-audio-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}

/** Midpoints (seconds) of natural pauses in the speech; scene changes are snapped to these so a cut never lands mid-word. */
export async function detectPauses(wav: Buffer): Promise<number[]> {
  return withTemp(async dir => {
    await writeFile(join(dir, "in.wav"), wav);
    const { stderr } = await runFfmpeg(["-hide_banner", "-nostats", "-i", join(dir, "in.wav"), "-af", "silencedetect=noise=-36dB:d=0.22", "-f", "null", "-"]);
    const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map(match => Number(match[1]));
    const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map(match => Number(match[1]));
    return starts.map((start, index) => ends[index] === undefined ? null : (start + ends[index]!) / 2).filter((value): value is number => value !== null);
  });
}

/** Loudness-normalised (about -14 LUFS, like the reference videos) mono AAC. Stored with the draft and reused for previews and publishing. */
export async function encodeVoice(wav: Buffer): Promise<Buffer> {
  return withTemp(async dir => {
    await writeFile(join(dir, "in.wav"), wav);
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", join(dir, "in.wav"), "-af", "loudnorm=I=-14:TP=-1.5:LRA=9,aresample=44100", "-ac", "1", "-c:a", "aac", "-b:a", "96k", join(dir, "voice.m4a")]);
    return readFile(join(dir, "voice.m4a"));
  });
}

export type SceneTiming = { start: number; end: number };

/**
 * Scene boundaries for a video whose voice runs from `leadIn` to `leadIn + voiceSeconds`. Boundaries are placed by narration length, then snapped to
 * the nearest natural pause within 1.4 s. The first scene starts at 0 and the last ends at `total`, after the final word plus a tail, so the voice is never cut off.
 */
export function planSceneTimings(sceneChars: number[], voiceSeconds: number, pauses: number[], options: { leadIn?: number; tail?: number; minScene?: number } = {}): { timings: SceneTiming[]; total: number } {
  const leadIn = options.leadIn ?? 0.35; const tail = options.tail ?? 1.4;
  const total = leadIn + voiceSeconds + tail;
  const minScene = Math.min(options.minScene ?? 1.8, (total / sceneChars.length) * 0.8); // never ask for more than the video can hold
  const sum = sceneChars.reduce((a, b) => a + b, 0) || 1;
  const boundaries: number[] = []; let cumulative = 0;
  for (let i = 0; i < sceneChars.length - 1; i++) {
    cumulative += sceneChars[i]!;
    const target = leadIn + (cumulative / sum) * voiceSeconds;
    let best = target; let bestDistance = 1.4;
    for (const pause of pauses) { const t = leadIn + pause; const distance = Math.abs(t - target); if (distance < bestDistance) { best = t; bestDistance = distance; } }
    boundaries.push(best);
  }
  const fixed: number[] = [];
  for (const [index, boundary] of boundaries.entries()) {
    const previous = fixed[index - 1] ?? 0; const remaining = boundaries.length - index;
    fixed.push(Math.min(Math.max(boundary, previous + minScene), total - minScene * remaining));
  }
  const edges = [0, ...fixed, total];
  return { timings: edges.slice(0, -1).map((start, index) => ({ start, end: edges[index + 1]! })), total };
}
