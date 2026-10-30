"use client";

/**
 * Persistent, collapsible left sidebar. Every entry corresponds to a real
 * implemented view — there are no decorative placeholders.
 */

import { AudioLines, BookOpen, Boxes, Combine, Cpu, House, KeySquare, ListChecks, Mic, MicOff, MicVocal, Music2, PanelLeftClose, PanelLeftOpen, Scissors, Settings, Split, ShieldCheck, type LucideIcon } from "lucide-react";
import { HELP_BY_ID } from "@/lib/studio/help-content";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useUi, type ViewId } from "@/lib/studio/store-ui";
import { useJobs } from "@/lib/studio/store-jobs";
import { cn } from "@/lib/utils";

interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Workspace",
    items: [
      { id: "home", label: "Home", icon: House },
      { id: "cutter", label: "Cutter", icon: Scissors },
      { id: "joiner", label: "Joiner", icon: Combine },
      { id: "pitcher", label: "Pitcher", icon: Music2 },
      { id: "key-bpm", label: "Key & BPM Finder", icon: KeySquare },
      { id: "recorder", label: "Recorder", icon: Mic },
      { id: "karaoke", label: "Karaoke", icon: MicVocal },
    ],
  },
  {
    title: "AI Processing",
    items: [
      { id: "remover", label: "Remover", icon: MicOff },
      { id: "splitter", label: "Splitter", icon: Split },
      { id: "models", label: "Model Manager", icon: Boxes },
    ],
  },
  {
    title: "System",
    items: [
      { id: "queue", label: "Processing Queue", icon: ListChecks },
      { id: "settings", label: "Settings", icon: Settings },
      { id: "system", label: "System Information", icon: Cpu },
      { id: "help", label: "Quick Help", icon: BookOpen },
    ],
  },
];

export function SidebarNav({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void } = {}) {
  const activeView = useUi((s) => s.activeView);
  const collapsedSetting = useUi((s) => s.sidebarCollapsed);
  const collapsed = mobile ? false : collapsedSetting;
  const setView = useUi((s) => s.setView);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const jobs = useJobs((s) => s.jobs);
  const activeJobs = jobs.filter((j) => ["queued", "preparing", "running", "cancelling"].includes(j.state)).length;

  return (
    <TooltipProvider delayDuration={200}>
      <nav aria-label="Application views" className="flex h-full flex-col">
        {/* Brand */}
        <div className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-3", collapsed && "justify-center px-2")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <AudioLines className="h-5 w-5 text-primary" aria-hidden />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">Vocalizer</p>
              <p className="truncate text-[10px] text-muted-foreground">Offline · Local-first</p>
            </div>
          )}
        </div>

        {/* Groups */}
        <div className={cn("studio-scroll flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-4 last:mb-0">
              {!collapsed && (
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = activeView === item.id;
                  const badge = item.id === "queue" && activeJobs > 0 ? activeJobs : null;
                  const button = (
                    <button
                      type="button"
                      onClick={() => { setView(item.id); onNavigate?.(); }}
                      aria-current={active ? "page" : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={cn(
                        "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-primary/15 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <item.icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} aria-hidden />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {badge !== null && (
                        <Badge
                          variant="secondary"
                          className={cn(
                            "ml-auto h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px] tabular-nums",
                            collapsed && "absolute ml-7 mt-[-22px]"
                          )}
                        >
                          {badge}
                        </Badge>
                      )}
                    </button>
                  );
                  return (
                    <li key={item.id}>
                      {mobile ? button : (
                        <Tooltip>
                          <TooltipTrigger asChild>{button}</TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs space-y-1">
                            <p className="font-semibold">{item.label}</p>
                            <p>{HELP_BY_ID[item.id].summary}</p>
                            <p className="opacity-80">{HELP_BY_ID[item.id].availability}</p>
                            <p className="opacity-80">Open the page and select Quick Help for every control.</p>
                          </TooltipContent>
                        </Tooltip>
                      )
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className={cn("shrink-0 border-t border-border p-3", collapsed && "px-2")}>
          {mobile ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Local processing · no cloud uploads
            </div>
          ) : collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <ButtonGhostCollapse collapsed={collapsed} onToggle={toggleSidebar} />
                </TooltipTrigger>
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              </Tooltip>
              <ShieldCheck className="h-4 w-4 text-muted-foreground/60" aria-hidden />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                <span className="truncate">Local-only · no uploads</span>
              </div>
              <ButtonGhostCollapse collapsed={collapsed} onToggle={toggleSidebar} />
            </div>
          )}
        </div>
      </nav>
    </TooltipProvider>
  );
}

function ButtonGhostCollapse({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
    </button>
  );
}
