import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCadence, forecastFirstPost, nextCampaignRun, type CadenceInput } from "../cadence.js";

const H = 3_600_000;
const base = (overrides: Partial<CadenceInput> = {}): CadenceInput => ({
  now: new Date("2026-10-24T09:30:00Z"), lastPublishedAt: null, oldestPublishedInWindow: null, publishedLast7Days: 0, qualifiedLeadsLast7Days: 0,
  minHoursBetweenPosts: 20, noLeadWaitHours: 33, maxPostsPer7Days: 7, ...overrides,
});

test("first ever post is allowed immediately", () => {
  assert.equal(evaluateCadence(base()).allowed, true);
});

test("with no recorded leads the agent waits 33 hours (about 1.5 days), not 3 days", () => {
  const last = new Date("2026-10-24T09:31:00Z");
  assert.equal(evaluateCadence(base({ now: new Date(last.getTime() + 23 * H), lastPublishedAt: last })).allowed, false);
  assert.equal(evaluateCadence(base({ now: new Date(last.getTime() + 41 * H), lastPublishedAt: last })).allowed, true);
});

test("with qualified leads recorded the agent posts about daily (20 hour gap)", () => {
  const last = new Date("2026-10-24T09:31:00Z");
  const input = base({ lastPublishedAt: last, qualifiedLeadsLast7Days: 2 });
  assert.equal(evaluateCadence({ ...input, now: new Date(last.getTime() + 19 * H) }).allowed, false);
  const ok = evaluateCadence({ ...input, now: new Date(last.getTime() + 23.9 * H) });
  assert.equal(ok.allowed, true);
  assert.equal(ok.leadMode, true);
});

test("the weekly cap overrides everything and reopens 7 days after the oldest post in the window", () => {
  const oldest = new Date("2026-10-20T04:00:00Z");
  const verdict = evaluateCadence(base({ lastPublishedAt: new Date("2026-10-23T04:00:00Z"), oldestPublishedInWindow: oldest, publishedLast7Days: 7, qualifiedLeadsLast7Days: 5 }));
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason ?? "", /weekly limit/);
  assert.equal(verdict.earliestAt?.toISOString(), "2026-10-27T04:00:00.000Z");
});

test("campaign runs twice a day: 09:30 and 19:30 Bangladesh time", () => {
  assert.equal(nextCampaignRun(new Date("2026-10-24T10:00:00Z")).toISOString(), "2026-10-24T13:30:00.000Z");
  assert.equal(nextCampaignRun(new Date("2026-10-24T14:00:00Z")).toISOString(), "2026-10-25T03:30:00.000Z");
  assert.equal(nextCampaignRun(new Date("2026-10-24T02:00:00Z")).toISOString(), "2026-10-24T03:30:00.000Z");
});

test("with no leads and a 33 h wait the rhythm is about every 1.5 days: 34 h then 38 h, alternating", () => {
  const input = base({ noLeadWaitHours: 33 });
  const first = new Date("2026-10-24T03:31:00Z");
  const second = forecastFirstPost({ ...input, now: new Date(first.getTime() + 60_000), lastPublishedAt: first }).firstPostAt;
  assert.equal(second.toISOString(), "2026-10-25T13:30:00.000Z");
  const third = forecastFirstPost({ ...input, now: new Date(second.getTime() + 60_000), lastPublishedAt: new Date(second.getTime() + 60_000) }).firstPostAt;
  assert.equal(third.toISOString(), "2026-10-27T03:30:00.000Z");
});

test("with leads recorded it posts about daily even though it runs twice a day (20 h gap)", () => {
  const last = new Date("2026-10-24T03:31:00Z");
  const next = forecastFirstPost(base({ now: new Date(last.getTime() + 60_000), lastPublishedAt: last, qualifiedLeadsLast7Days: 3 })).firstPostAt;
  assert.equal(next.toISOString(), "2026-10-25T03:30:00.000Z");
});

test("a manual post at 3:25 PM Bangladesh time: the runs at 7:30 PM and 9:30 AM wait; the agent resumes two mornings later", () => {
  const forecast = forecastFirstPost(base({ now: new Date("2026-10-24T09:40:00Z"), lastPublishedAt: new Date("2026-10-24T09:25:00Z"), noLeadWaitHours: 33 }));
  assert.equal(forecast.willPostAtNextRun, false);
  assert.equal(forecast.firstPostAt.toISOString(), "2026-10-26T03:30:00.000Z");
});
