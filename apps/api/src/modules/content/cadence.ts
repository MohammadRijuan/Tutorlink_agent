/**
 * Posting rhythm. Pure functions, so the rules the agent follows are also what the dashboard forecasts.
 *  - With qualified/booked leads recorded in the last 7 days: post as often as MIN_HOURS_BETWEEN_POSTS allows (about daily).
 *  - With none recorded: wait NO_LEAD_WAIT_HOURS (default 33 h) instead of posting blindly. The campaign runs twice a day
 *    (9:30 AM and 7:30 PM Bangladesh time), so 33 h gives a post about every 1.5 days (34 h, then 38 h, alternating).
 *  - Never more than MAX_POSTS_PER_7_DAYS.
 */
export type CadenceInput = {
  now: Date;
  lastPublishedAt: Date | null;
  oldestPublishedInWindow: Date | null;
  publishedLast7Days: number;
  qualifiedLeadsLast7Days: number;
  minHoursBetweenPosts: number;
  noLeadWaitHours: number;
  maxPostsPer7Days: number;
};

export type CadenceVerdict = { allowed: boolean; reason: string | null; requiredGapHours: number; earliestAt: Date | null; leadMode: boolean };

const HOUR = 3_600_000;

export function evaluateCadence(input: CadenceInput): CadenceVerdict {
  const leadMode = input.qualifiedLeadsLast7Days > 0;
  const requiredGapHours = leadMode ? input.minHoursBetweenPosts : Math.max(input.minHoursBetweenPosts, input.noLeadWaitHours);
  let earliest: Date | null = input.lastPublishedAt ? new Date(input.lastPublishedAt.getTime() + requiredGapHours * HOUR) : null;
  let reason: string | null = null;

  if (input.publishedLast7Days >= input.maxPostsPer7Days && input.oldestPublishedInWindow) {
    const reopens = new Date(input.oldestPublishedInWindow.getTime() + 7 * 24 * HOUR);
    if (!earliest || reopens > earliest) earliest = reopens;
    if (input.now < reopens) reason = `The weekly limit of ${input.maxPostsPer7Days} posts has been reached.`;
  }
  if (!reason && input.lastPublishedAt && earliest && input.now < earliest) {
    const hours = Math.round((input.now.getTime() - input.lastPublishedAt.getTime()) / HOUR);
    reason = leadMode
      ? `A post was published ${hours} hours ago; the minimum gap is ${requiredGapHours} hours.`
      : `No qualified or booked lead is recorded in the last 7 days, so the agent spaces posts at least ${requiredGapHours} hours apart (last post ${hours} hours ago). Mark real enquiries as Qualified to unlock daily posting.`;
  }
  return { allowed: reason === null, reason, requiredGapHours, earliestAt: earliest, leadMode };
}

/** Campaign run times (vercel.json): 03:30 UTC = 09:30 and 13:30 UTC = 19:30 Bangladesh time. */
export const CAMPAIGN_RUNS_UTC: Array<[number, number]> = [[3, 30], [13, 30]];

export function nextCampaignRun(now: Date): Date {
  const candidates: Date[] = [];
  for (const dayOffset of [0, 1]) for (const [hour, minute] of CAMPAIGN_RUNS_UTC) candidates.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hour, minute, 0)));
  return candidates.filter(candidate => candidate.getTime() > now.getTime()).sort((a, b) => a.getTime() - b.getTime())[0]!;
}

/** First campaign run at which the cadence rules would let a post out, assuming nothing changes (no new leads, nothing else published). */
export function forecastFirstPost(input: CadenceInput): { nextRunAt: Date; willPostAtNextRun: boolean; firstPostAt: Date; verdictNow: CadenceVerdict } {
  const verdictNow = evaluateCadence(input);
  const nextRunAt = nextCampaignRun(input.now);
  let run = nextRunAt;
  for (let i = 0; i < 30; i++) {
    const verdict = evaluateCadence({ ...input, now: new Date(run.getTime() + 5_000) });
    if (verdict.allowed) return { nextRunAt, willPostAtNextRun: run.getTime() === nextRunAt.getTime(), firstPostAt: run, verdictNow };
    run = nextCampaignRun(new Date(run.getTime() + 60_000));
  }
  return { nextRunAt, willPostAtNextRun: false, firstPostAt: run, verdictNow };
}
