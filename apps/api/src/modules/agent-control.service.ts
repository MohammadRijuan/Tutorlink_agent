import { prisma } from "../lib/prisma.js";

export type AutomationState = { paused: boolean; agentMode: boolean; guidance: string };

/** Fail-safe read: a missing or malformed value means "paused / Agent Mode off". A database error propagates, so nothing runs blind. */
export async function getAutomationState(): Promise<AutomationState> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: ["globalAutomationPaused", "agentMode", "agentGuidance"] } } });
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return { paused: values.globalAutomationPaused !== false, agentMode: values.agentMode === true, guidance: typeof values.agentGuidance === "string" ? values.agentGuidance : "" };
}

export function automationActive(state: AutomationState) {
  return !state.paused && state.agentMode;
}

export const AUTONOMOUS_ACTORS = ["autonomous-agent", "scheduled-publisher"];

/** Used when a safety condition (revoked permission, ambiguous publish, repeated failures) requires a human before anything else is published. */
export async function autoPause(reason: string, actor = "safety-guard") {
  await prisma.$transaction([
    prisma.systemSetting.upsert({ where: { key: "globalAutomationPaused" }, update: { value: true }, create: { key: "globalAutomationPaused", value: true } }),
    prisma.systemSetting.upsert({ where: { key: "agentMode" }, update: { value: false }, create: { key: "agentMode", value: false } }),
    prisma.auditEvent.create({ data: { actor, action: "AUTOMATION_AUTO_PAUSED", details: { reason: reason.slice(0, 500) } as never } }),
  ]);
}
