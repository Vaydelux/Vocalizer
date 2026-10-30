"use client";

/**
 * Application shell — persistent sidebar + view switcher + sticky footer.
 * All views are client-rendered inside this shell on the / route.
 */

import { useEffect, useState, useRef } from "react";
import { Menu, AudioLines } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorBoundary } from "./error-boundary";
import { SidebarNav } from "./sidebar-nav";
import { StatusFooter } from "./status-footer";
import { useUi, type ViewId } from "@/lib/studio/store-ui";
import { useSettings } from "@/lib/studio/store-settings";
import { cn } from "@/lib/utils";

import { HomeView } from "@/features/studio/home-view";
import { CutterView } from "@/features/studio/cutter-view";
import { JoinerView } from "@/features/studio/joiner-view";
import { PitcherView } from "@/features/studio/pitcher-view";
import { KeyBpmView } from "@/features/studio/key-bpm-view";
import { RecorderView } from "@/features/studio/recorder-view";
import { KaraokeView } from "@/features/studio/karaoke-view";
import { RemoverView } from "@/features/studio/remover-view";
import { SplitterView } from "@/features/studio/splitter-view";
import { ModelsView } from "@/features/studio/models-view";
import { QueueView } from "@/features/studio/queue-view";
import { SettingsView } from "@/features/studio/settings-view";
import { SystemView } from "@/features/studio/system-view";
import { HelpView } from "@/features/studio/help-view";

function ActiveView() {
  const view = useUi((s) => s.activeView);
  switch (view) {
    case "home":
      return <HomeView />;
    case "cutter":
      return <CutterView />;
    case "joiner":
      return <JoinerView />;
    case "pitcher":
      return <PitcherView />;
    case "key-bpm":
      return <KeyBpmView />;
    case "recorder":
      return <RecorderView />;
    case "karaoke":
      return <KaraokeView />;
    case "remover":
      return <RemoverView />;
    case "splitter":
      return <SplitterView />;
    case "models":
      return <ModelsView />;
    case "queue":
      return <QueueView />;
    case "settings":
      return <SettingsView />;
    case "system":
      return <SystemView />;
    case "help":
      return <HelpView />;
    default:
      return <HomeView />;
  }
}

export function AppShell() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const activeView = useUi((s) => s.activeView);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);

  // Apply theme + accent to the document root (dark is the default).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.accent = accent;
  }, [theme, accent]);

  useEffect(() => {
    const destinations: ViewId[] = ["home", "cutter", "joiner", "pitcher", "remover", "queue"];
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          (target instanceof HTMLElement &&
            (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable))) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < destinations.length) {
        event.preventDefault();
        useUi.getState().setView(destinations[index]);
        setMobileNavOpen(false);
        mainRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  return (
    <div className="flex h-dvh w-full min-w-0 overflow-hidden bg-background text-foreground">
      <aside className={cn(
        "hidden shrink-0 border-r border-border bg-card/40 transition-[width] duration-200 md:block",
        collapsed ? "w-14" : "w-60"
      )}>
        <SidebarNav />
      </aside>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 max-w-[88vw] gap-0 p-0 md:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Vocalizer navigation</SheetTitle>
            <SheetDescription>Choose a workspace tool. Press Escape to close.</SheetDescription>
          </SheetHeader>
          <SidebarNav mobile onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-3 md:hidden">
          <Button size="icon" variant="ghost" aria-label="Open navigation" aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}>
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
          <AudioLines className="h-5 w-5 text-primary" aria-hidden />
          <span className="text-sm font-semibold">Vocalizer</span>
          <span className="ml-auto truncate text-xs text-muted-foreground" aria-label={`Current view: ${activeView}`}>
            {activeView.replaceAll("-", " ")}
          </span>
        </header>
        <main id="studio-main" ref={mainRef} tabIndex={-1}
          className="studio-scroll min-h-0 flex-1 overflow-y-auto outline-none">
          <ErrorBoundary key={activeView}>
            <div className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 sm:py-6">
              <ActiveView />
            </div>
          </ErrorBoundary>
        </main>
        <StatusFooter />
      </div>
    </div>
  );
}
