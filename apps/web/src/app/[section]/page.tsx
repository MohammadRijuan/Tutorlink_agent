import { DashboardShell } from "@/components/layout/dashboard-shell";
import { DashboardSectionPage } from "@/components/dashboard/section-page";

export function generateStaticParams() {
  return ["page-analyzer", "performance-monitor", "strategy-lab", "content-studio", "publishing-calendar", "qualified-leads", "learning-log", "settings", "documentation"].map((section) => ({ section }));
}

export default async function SectionRoute({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <DashboardShell><DashboardSectionPage section={section} /></DashboardShell>;
}
