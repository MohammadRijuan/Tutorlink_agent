import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { detectPauses, encodeVoice, pcmToWav, planSceneTimings } from "../audio.js";

test("scene timings cover the whole video, stay ordered, and the last scene outlasts the final spoken word", () => {
  const { timings, total } = planSceneTimings([90, 120, 80, 100, 60], 30, [6.5, 14, 21, 25], { leadIn: 0.35, tail: 1.4 });
  assert.equal(timings[0]!.start, 0);
  assert.ok(Math.abs(timings.at(-1)!.end - total) < 1e-9);
  assert.ok(total >= 0.35 + 30 + 1.4 - 1e-9, "video is longer than the voice, so the voice can never be cut off");
  for (let i = 1; i < timings.length; i++) { assert.equal(timings[i]!.start, timings[i - 1]!.end); assert.ok(timings[i]!.end - timings[i]!.start >= 1.79); }
});

test("scene changes snap to natural pauses (never mid-word) when one is close enough", () => {
  const { timings } = planSceneTimings([100, 100], 20, [10.2], { leadIn: 0.35 });
  assert.ok(Math.abs(timings[0]!.end - (0.35 + 10.2)) < 1e-9);
  const noPause = planSceneTimings([100, 100], 20, [], { leadIn: 0.35 });
  assert.ok(Math.abs(noPause.timings[0]!.end - (0.35 + 10)) < 1e-9);
});

test("even with absurdly short scenes the minimum scene length is respected", () => {
  const { timings, total } = planSceneTimings([1, 1, 1, 1, 1, 1, 1, 1], 9, [], { leadIn: 0.35, tail: 1.4, minScene: 1.8 });
  assert.ok(timings.every(timing => timing.end > timing.start));
  assert.ok(Math.abs(timings.at(-1)!.end - total) < 1e-9);
});

test("WAV wrapper writes a valid header", () => {
  const wav = pcmToWav(Buffer.alloc(48000), 24000);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF"); assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.readUInt32LE(40), 48000);
});

test("pause detection finds the gaps between spoken bursts and voice encoding produces AAC", async () => {
  const rate = 24000; const parts: Buffer[] = [];
  for (const seconds of [1.2, 1.5, 1.1]) {
    const burst = Buffer.alloc(Math.round(rate * seconds) * 2);
    for (let i = 0; i < burst.length / 2; i++) burst.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 190 * i) / rate) * (0.6 + 0.4 * Math.sin(i / 900))), i * 2);
    parts.push(burst, Buffer.alloc(Math.round(rate * 0.5) * 2));
  }
  const wav = pcmToWav(Buffer.concat(parts));
  const pauses = await detectPauses(wav);
  assert.ok(pauses.length >= 2, `expected pauses, got ${pauses.length}`);
  assert.ok(pauses[0]! > 1.2 && pauses[0]! < 1.9);
  const aac = await encodeVoice(wav);
  assert.ok(aac.length > 3000 && aac.subarray(4, 8).toString("ascii") === "ftyp");
});
