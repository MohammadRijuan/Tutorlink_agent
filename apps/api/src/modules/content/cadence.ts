/**
 * Posting rhythm. Pure functions, so the rules the agent follows are also what the dashboard forecasts.
 *  - With qualified/booked leads recorded in the last 7 days: post as often as MIN_HOURS_BETWEEN_POSTS allows (about daily).
 *  - With none recorded: wait NO_LEAD_WAIT_HOURS (default 40 h, i.e. every second daily run) instead of posting blindly.
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

/** The daily Vercel Cron for the campaign (vercel.json: 30 3 * * * = 03:30 UTC = 09:30 Bangladesh time). */
export function nextCampaignRun(now: Date): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 30, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** First campaign run at which the cadence rules would let a post out, assuming nothing changes (no new leads, nothing else published). */
export function forecastFirstPost(input: CadenceInput): { nextRunAt: Date; willPostAtNextRun: boolean; firstPostAt: Date; verdictNow: CadenceVerdict } {
  const verdictNow = evaluateCadence(input);
  const nextRunAt = nextCampaignRun(input.now);
  let run = nextRunAt;
  for (let i = 0; i < 14; i++) {
    const verdict = evaluateCadence({ ...input, now: new Date(run.getTime() + 5_000) });
    if (verdict.allowed) return { nextRunAt, willPostAtNextRun: run.getTime() === nextRunAt.getTime(), firstPostAt: run, verdictNow };
    run = new Date(run.getTime() + 24 * HOUR);
  }
  return { nextRunAt, willPostAtNextRun: false, firstPostAt: run, verdictNow };
}
