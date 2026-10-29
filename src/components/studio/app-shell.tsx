"use client";

/**
 * Application shell — persistent sidebar + view switcher + sticky footer.
 * All views are client-rendered inside this shell on the / route.
 */

import { useEffect } from "react";
import { ErrorBoundary } from "./error-boundary";
import { SidebarNav } from "./sidebar-nav";
import { StatusFooter } from "./status-footer";
import { useUi } from "@/lib/studio/store-ui";
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
    default:
      return <HomeView />;
  }
}

export function AppShell() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);

  // Apply theme + accent to the document root (dark is the default).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.accent = accent;
  }, [theme, accent]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          "shrink-0 border-r border-border bg-card/40 transition-[width] duration-200",
          collapsed ? "w-14" : "w-60"
        )}
      >
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="studio-scroll flex-1 overflow-y-auto" aria-live="polite">
          <ErrorBoundary>
            <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
              <ActiveView />
            </div>
          </ErrorBoundary>
        </main>
        <StatusFooter />
      </div>
    </div>
  );
}
