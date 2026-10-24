import Link from "next/link";
import type { ComponentType } from "react";
import { allNavigation } from "@/lib/navigation";
import { ContentStudio, DocumentationModule, LearningLog, PageAnalyzer, PerformanceMonitor, PublishingCalendar, QualifiedLeads, SettingsModule, StrategyLab } from "@/components/workspace/modules";

const modules: Record<string, ComponentType> = {
  "page-analyzer": PageAnalyzer,
  "performance-monitor": PerformanceMonitor,
  "strategy-lab": StrategyLab,
  "content-studio": ContentStudio,
  "publishing-calendar": PublishingCalendar,
  "qualified-leads": QualifiedLeads,
  "learning-log": LearningLog,
  settings: SettingsModule,
  documentation: DocumentationModule,
};
export function DashboardSectionPage({ section }: { section: string }) {
  const item = allNavigation.find((entry) => entry.href === `/${section}`);
  if (!item) return <div className="content"><div className="page-heading"><div><div className="eyebrow">404 / Route not found</div><h1>This page doesn’t exist.</h1><p>Use the sidebar to return to a supported workspace route.</p></div><Link className="action-button" href="/">Back to overview</Link></div></div>;
  const Module = modules[section];
  return <div className="content"><div className="page-heading"><div><div className="eyebrow">TutorLink / Workspace module</div><h1>{item.label}</h1><p>{item.description}</p></div><div className="status-pill"><span className="status-dot"/>Private workspace</div></div>{Module ? <Module/> : <p>This module is unavailable.</p>}</div>;
}
