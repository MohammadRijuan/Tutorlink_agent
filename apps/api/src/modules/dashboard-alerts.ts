import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getAiUsage } from "./ai/ai.service.js";
import { getAutomationState } from "./agent-control.service.js";
import { getBusinessProfile } from "./business/business.service.js";
import { publicBaseUrl } from "./share.routes.js";

export type Alert = { id: string; level: "action" | "warn" | "info"; title: string; detail: string; where?: string };

/** The short "what you need to do" list shown on the dashboard. Every item states a concrete next step. */
export async function buildAlerts(snapshotGaps: Array<{ area: string; message: string; fix: string }> = []): Promise<Alert[]> {
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const [state, stuck, newLeads, qualified7, publishedTotal, webhookEvents, profile, usage] = await Promise.all([
    getAutomationState(),
    prisma.contentItem.count({ where: { status: "PUBLISHING" } }),
    prisma.lead.count({ where: { status: "NEW" } }),
    prisma.lead.count({ where: { status: { in: ["QUALIFIED", "BOOKED"] }, createdAt: { gte: weekAgo } } }),
    prisma.contentItem.count({ where: { status: "PUBLISHED" } }),
    prisma.metaWebhookEvent.count(),
    getBusinessProfile().catch(() => null),
    getAiUsage().catch(() => null),
  ]);
  const alerts: Alert[] = [];
  if (stuck > 0) alerts.push({ id: "stuck-publish", level: "action", title: "A post is stuck in Publishing", detail: "Open the Facebook Page. If the post is not there, click Confirm not on Facebook on that draft so the agent can continue.", where: "content-studio" });
  if (state.paused || !state.agentMode) alerts.push({ id: "agent-off", level: "warn", title: "Agent Mode is OFF", detail: "The agent will not post by itself. Switch it ON from the top bar when you are ready.", where: "settings" });
  if (env.META_PUBLISH_MODE !== "live") alerts.push({ id: "dry-run", level: "warn", title: "Publishing is in dry-run mode", detail: "Nothing is sent to Facebook. Set META_PUBLISH_MODE=live on the API project and redeploy when your staging checks pass.", where: "settings" });
  if (newLeads > 0) alerts.push({ id: "label-leads", level: "action", title: `${newLeads} enquir${newLeads === 1 ? "y needs" : "ies need"} your label`, detail: "Mark each one Qualified, Unqualified or Booked. This is how the agent learns what brings real leads and how it unlocks daily posting.", where: "qualified-leads" });
  if (publishedTotal >= 2 && qualified7 === 0) alerts.push({ id: "no-leads", level: "warn", title: "No qualified lead recorded in 7 days", detail: "The agent therefore posts about every 2 days instead of daily. Record real enquiries (including WhatsApp/phone ones) under Qualified leads, and check that the webhook works.", where: "qualified-leads" });
  if (publishedTotal >= 1 && webhookEvents === 0) alerts.push({ id: "webhook-silent", level: "warn", title: "No message or comment has reached the webhook yet", detail: "Message your Page from another account and see if a lead appears. If not, re-check the Meta webhook subscription (messages, messaging_postbacks, messaging_referrals, feed) and the app's Live mode.", where: "qualified-leads" });
  if (snapshotGaps.length > 0) alerts.push({ id: "meta-gaps", level: "warn", title: "Some Meta numbers are unavailable", detail: `${snapshotGaps[0]!.area}: ${snapshotGaps[0]!.fix}`, where: "page-analyzer" });
  if (profile && !profile.configured) alerts.push({ id: "business-facts", level: "info", title: "Review your business facts", detail: "The agent is using the facts from your banner (programs, universities, verified teachers). Check them and press Save under Settings.", where: "settings" });
  if (usage?.usedToday != null && usage.usedToday >= usage.dailyLimit * 0.8) alerts.push({ id: "ai-quota", level: "warn", title: "Free AI quota is nearly used up today", detail: `${usage.usedToday} of ${usage.dailyLimit} requests used. It resets at midnight Bangladesh time.`, where: "settings" });
  if (!publicBaseUrl() && env.META_POST_STYLE === "auto") alerts.push({ id: "public-url", level: "info", title: "Native Send Message button is not active", detail: "Set PUBLIC_API_URL (your API's https address) on the API project and redeploy. Until then posts use a photo with a Messenger link.", where: "settings" });
  const order = { action: 0, warn: 1, info: 2 } as const;
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}
