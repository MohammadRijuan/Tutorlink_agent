/** TutorLink operates in Bangladesh (UTC+6, no daylight saving). Vercel runs in UTC, so day boundaries are computed explicitly. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Start (00:00 Asia/Dhaka) of the Dhaka calendar day containing `now`, returned as a UTC Date. */
export function startOfDhakaDay(now = new Date()): Date {
  const shifted = new Date(now.getTime() + DHAKA_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - DHAKA_OFFSET_MS);
}

export function dhakaDateKey(now = new Date()): string {
  return new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}
