import { env } from "../../config/env.js";
import { detectPauses, encodeVoice, pcmToWav } from "./audio.js";
import { fullNarration, type ReelPlan } from "./reel-plan.js";
import { synthesizeSpeech, VoiceUnavailableError } from "./tts.service.js";

export type ReelVoice = { audio: Buffer; seconds: number; pauses: number[]; voice: string; model: string };

/**
 * Speaks the WHOLE narration once, then analyses and stores it. The video is built around this audio, so it is complete by construction:
 * if the speech cannot be produced, or would make the video longer than allowed, no Reel is created at all.
 */
export async function createVoiceForPlan(plan: ReelPlan): Promise<ReelVoice> {
  const speech = await synthesizeSpeech(fullNarration(plan));
  const totalSeconds = 0.35 + speech.seconds + 1.4;
  if (totalSeconds > env.REEL_MAX_SECONDS) throw new VoiceUnavailableError(`The narration takes ${Math.round(speech.seconds)} s to speak, which would make the video ${Math.round(totalSeconds)} s: over the ${env.REEL_MAX_SECONDS} s limit.`, "VALIDATION");
  const wav = pcmToWav(speech.pcm);
  const [pauses, audio] = await Promise.all([detectPauses(wav), encodeVoice(wav)]);
  return { audio, seconds: speech.seconds, pauses, voice: speech.voice, model: speech.model };
}
