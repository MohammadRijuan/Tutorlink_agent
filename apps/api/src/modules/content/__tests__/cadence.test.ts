import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCadence, forecastFirstPost, nextCampaignRun, type CadenceInput } from "../cadence.js";

const H = 3_600_000;
const base = (overrides: Partial<CadenceInput> = {}): CadenceInput => ({
  now: new Date("2026-10-24T09:30:00Z"), lastPublishedAt: null, oldestPublishedInWindow: null, publishedLast7Days: 0, qualifiedLeadsLast7Days: 0,
  minHoursBetweenPosts: 20, noLeadWaitHours: 40, maxPostsPer7Days: 7, ...overrides,
});

test("first ever post is allowed immediately", () => {
  assert.equal(evaluateCadence(base()).allowed, true);
});

test("with no recorded leads the agent waits 40 hours (every second daily run), not 3 days", () => {
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

test("next campaign run is 03:30 UTC (09:30 Bangladesh time)", () => {
  assert.equal(nextCampaignRun(new Date("2026-10-24T10:00:00Z")).toISOString(), "2026-10-25T03:30:00.000Z");
  assert.equal(nextCampaignRun(new Date("2026-10-24T02:00:00Z")).toISOString(), "2026-10-24T03:30:00.000Z");
});

test("forecast: a post made at the 09:30 run with no leads goes out two days later at the 09:30 run", () => {
  const forecast = forecastFirstPost(base({ now: new Date("2026-10-24T03:35:00Z"), lastPublishedAt: new Date("2026-10-24T03:31:00Z") }));
  assert.equal(forecast.willPostAtNextRun, false);
  assert.equal(forecast.firstPostAt.toISOString(), "2026-10-26T03:30:00.000Z");
});

test("forecast: with leads recorded the very next run posts", () => {
  const forecast = forecastFirstPost(base({ now: new Date("2026-10-24T03:35:00Z"), lastPublishedAt: new Date("2026-10-24T03:31:00Z"), qualifiedLeadsLast7Days: 1 }));
  assert.equal(forecast.willPostAtNextRun, true);
});

test("a manual post at 3:25 PM Bangladesh time skips the next morning (18 h) and the agent resumes two days later at 09:30", () => {
  const forecast = forecastFirstPost(base({ now: new Date("2026-10-24T09:40:00Z"), lastPublishedAt: new Date("2026-10-24T09:25:00Z") }));
  assert.equal(forecast.nextRunAt.toISOString(), "2026-10-25T03:30:00.000Z");
  assert.equal(forecast.willPostAtNextRun, false);
  assert.equal(forecast.firstPostAt.toISOString(), "2026-10-26T03:30:00.000Z");
});
