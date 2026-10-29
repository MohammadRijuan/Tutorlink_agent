"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/components/workspace/api";
import { Menu, Pause, Power, X, LogOut } from "lucide-react";
import { bustCache, prefetch, send } from "@/components/workspace/api";
import { allNavigation, systemNavigation, workspaceNavigation } from "@/lib/navigation";

function NavigationGroup({ label, items, onNavigate }: { label: string; items: typeof allNavigation; onNavigate: () => void }) {
  const pathname = usePathname();
  return <div>
    <div className="nav-label">{label}</div>
    <nav className="nav-list" aria-label={`${label} navigation`}>
      {items.map(({ label: itemLabel, href, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
        return <Link key={href} href={href} onClick={onNavigate} className={`nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined} title={itemLabel}>
          <Icon size={17} strokeWidth={1.7}/><span>{itemLabel}</span>
        </Link>;
      })}
    </nav>
  </div>;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  type SafetyStatus = {globalAutomationPaused:boolean;agentMode:boolean;publishMode?:string;inFlight?:{publishing:number};integrations?:{metaConfigured?:boolean}};
  const [safetyStatus, setSafetyStatus] = useState<SafetyStatus | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleNote, setToggleNote] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => { try { const result = await api<SafetyStatus>("settings"); if (active) setSafetyStatus(result); } catch { if (active) setSafetyStatus(null); } };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 30000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  useEffect(() => {
    // Warm the cache for the pages people open next, so every click after the first feels instant.
    const timer = window.setTimeout(() => prefetch(["overview", "campaign/outlook", "content", "leads", "business-profile", "agent/guidance", "page/snapshots", "performance"]), 400);
    return () => window.clearTimeout(timer);
  }, []);
  async function toggleAgentMode() {
    if (!safetyStatus || toggling) return;
    setToggling(true); setToggleNote("");
    try {
      if (safetyStatus.agentMode) {
        const result = await api<SafetyStatus>("settings/safety", send("PATCH", { agentMode: false }));
        setSafetyStatus(old => old ? { ...old, ...result, agentMode: false } : old);
        const inFlight = safetyStatus.inFlight?.publishing ?? 0;
        setToggleNote(inFlight > 0 ? `Agent Mode is OFF. ${inFlight} publish already sent to Meta cannot be recalled; check the Page.` : "Agent Mode is OFF. You are in human control; nothing new will start.");
      } else {
        if (!window.confirm(`Turn Agent Mode ON? The agent may then choose content and ${safetyStatus.publishMode === "live" ? "PUBLISH to your public Facebook Page" : "create dry-run previews (publishing is in dry-run mode)"} without asking you first. You can switch it OFF here at any time.`)) return;
        const result = await api<SafetyStatus>("settings/safety", send("PATCH", { globalAutomationPaused: false, agentMode: true, confirmation: "ENABLE_AGENT_MODE" }));
        setSafetyStatus(old => old ? { ...old, ...result, agentMode: true, globalAutomationPaused: false } : old);
        setToggleNote("Agent Mode is ON.");
      }
    } catch (error) { setToggleNote(error instanceof Error ? error.message : "Could not change Agent Mode."); }
    finally { setToggling(false); window.setTimeout(() => setToggleNote(""), 9000); }
  }
  const activeItem = allNavigation.find((item) => item.href === pathname) ?? allNavigation.find((item) => item.href !== "/" && pathname.startsWith(`${item.href}/`));
  async function logout() {
    setLoggingOut(true);
    try { bustCache(); await fetch("/api/auth/logout", { method: "POST" }); } finally { bustCache(); router.replace("/login"); router.refresh(); }
  }
  const closeMobile = () => setMobileOpen(false);
  return <div className="shell">
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={closeMobile} />}
    <aside className={`sidebar${mobileOpen ? " mobile-open" : ""}`}>
      <div className="sidebar-brand-row"><Link href="/" className="brand" onClick={closeMobile} style={{ color: "inherit", textDecoration: "none" }}>
        <div className="brand-mark">T/</div>
        <div className="brand-copy"><div className="brand-name">tutorlink</div><div className="brand-sub">growth systems</div></div>
      </Link><button className="mobile-close" onClick={closeMobile} aria-label="Close navigation"><X size={20}/></button></div>
      <NavigationGroup label="Workspace" items={workspaceNavigation} onNavigate={closeMobile}/>
      <NavigationGroup label="System" items={systemNavigation} onNavigate={closeMobile}/>
      <div className="side-bottom">AUTONOMY CORE / 1.1.0<br/>Lead quality over vanity metrics.</div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <button className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={21}/></button>
        <Link href="/" className="mobile-brand" style={{ color: "inherit", textDecoration: "none" }}><div className="brand-mark">T/</div><span>TutorLink / Growth</span></Link>
        <div className="eyebrow">{activeItem?.label ?? "Organic growth"} / Control room</div>
        <div className="topbar-actions"><div className="status-pill"><span className="status-dot"/><span>{safetyStatus?.integrations?.metaConfigured ? "Meta credentials set" : "Meta setup required"}</span></div><button type="button" className={`agent-toggle ${safetyStatus?.agentMode ? "on" : "off"}`} onClick={toggleAgentMode} disabled={!safetyStatus || toggling} role="switch" aria-checked={Boolean(safetyStatus?.agentMode)} aria-label="Agent Mode" title={safetyStatus?.agentMode ? "Click to switch the agent OFF (human control)" : "Click to switch the agent ON"}><Power size={13}/><span>{!safetyStatus ? "Agent Mode …" : safetyStatus.agentMode ? "Agent Mode ON" : safetyStatus.globalAutomationPaused ? "Agent OFF · paused" : "Agent Mode OFF"}</span><span className="agent-switch" aria-hidden="true"><span/></span></button><button className="logout-button" onClick={logout} disabled={loggingOut} aria-label="Sign out"><LogOut size={14}/><span>{loggingOut ? "Signing out" : "Sign out"}</span></button></div>
      </header>
      {toggleNote && <div className="toggle-note" role="status"><Pause size={13}/> {toggleNote}</div>}
      {children}
    </main>
  </div>;
}
