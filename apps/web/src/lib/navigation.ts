import {
  Activity, CalendarClock, ChartNoAxesCombined, CircleHelp, FileText,
  FlaskConical, Gauge, LayoutDashboard, ScanSearch, Settings2, ShieldCheck,
  Target, Users, type LucideIcon,
} from "lucide-react";

export type NavigationItem = { label: string; href: string; icon: LucideIcon; description: string };

export const workspaceNavigation: NavigationItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard, description: "Your organic growth control room." },
  { label: "Page analyzer", href: "/page-analyzer", icon: ScanSearch, description: "Review Facebook Page performance, post reach, Reel views, and data gaps." },
  { label: "Performance monitor", href: "/performance-monitor", icon: Gauge, description: "Compare available Page insights with qualified-lead outcomes and get evidence-based recommendations." },
  { label: "Strategy lab", href: "/strategy-lab", icon: FlaskConical, description: "Turn evidence and qualified-lead outcomes into practical experiments." },
  { label: "Content studio", href: "/content-studio", icon: FileText, description: "Create Bangla-first posts, Reel scripts, and hashtags using verified TutorLink facts." },
  { label: "Publishing calendar", href: "/publishing-calendar", icon: CalendarClock, description: "Review planned content and publishing status before anything goes live." },
  { label: "Qualified leads", href: "/qualified-leads", icon: Users, description: "Track qualified enquiries and their downstream booking outcomes." },
  { label: "Learning log", href: "/learning-log", icon: ChartNoAxesCombined, description: "Keep an evidence trail of experiments, results, and decisions." },
];

export const systemNavigation: NavigationItem[] = [
  { label: "Integrations & settings", href: "/settings", icon: Settings2, description: "Manage integrations, safety controls, and workspace preferences." },
  { label: "Documentation", href: "/documentation", icon: CircleHelp, description: "Read setup notes, system rules, and implementation status." },
];

export const allNavigation = [...workspaceNavigation, ...systemNavigation];
