"use client";

/**
 * Sticky status footer — always visible at the bottom of the shell (the shell
 * is a fixed-height flex column, so it never floats or overlaps content).
 * Shows real state only: active job count and processing notice.
 */

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { isNative } from "@/lib/studio/native";
import { useJobs } from "@/lib/studio/store-jobs";
import { APP_VERSION } from "@/lib/studio/app-info";

export function StatusFooter() {
  const [desktopRuntime, setDesktopRuntime] = useState(false);
  useEffect(() => setDesktopRuntime(isNative()), []);
  const jobs = useJobs((s) => s.jobs);
  const active = jobs.filter((j) => ["queued", "preparing", "running", "cancelling"].includes(j.state));
  const current = active.find((j) => j.state === "running") ?? active[0];

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-border bg-card/60 px-3 text-[11px] text-muted-foreground backdrop-blur">
      <span className="shrink-0 font-medium">Vocalizer v{APP_VERSION}</span>
      <span className="hidden shrink-0 sm:inline">{desktopRuntime ? "· Windows desktop runtime" : "· Web preview runtime"}</span>
      <span className="min-w-0 flex-1 truncate text-right sm:text-left">
        {current ? (
          <span className="inline-flex items-center gap-1.5">
            <LoaderCircle className="h-3 w-3 animate-spin text-primary" aria-hidden />
            {current.state === "cancelling"
              ? `Cancelling “${current.label}”…`
              : `${current.label} — ${current.stage ?? current.state}${
                  current.progress !== null ? ` (${Math.round(current.progress * 100)}%)` : ""
                }`}
          </span>
        ) : (
          <span className="hidden sm:inline">Idle · all processing runs on this device</span>
        )}
      </span>
      <span className="hidden shrink-0 md:inline">
        {active.length > 0 ? `${active.length} active job${active.length > 1 ? "s" : ""}` : "Queue empty"}
      </span>
    </footer>
  );
}
