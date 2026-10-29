"use client";

/**
 * Processing Queue — live job list with real states, progress, cancellation,
 * verified outputs, logs, and typed errors. Jobs are isolated from navigation
 * (they live in the store, not in any page).
 */

import { useState } from "react";
import { ListChecks, XCircle, Download, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useJobs } from "@/lib/studio/store-jobs";
import { downloadResult } from "@/lib/studio/download";
import { formatBytes } from "@/lib/studio/format";
import type { JobState } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

const STATE_BADGE: Record<JobState, { label: string; className: string }> = {
  queued: { label: "Queued", className: "border-border text-muted-foreground" },
  preparing: { label: "Preparing", className: "border-primary/40 text-primary" },
  running: { label: "Running", className: "border-primary/40 text-primary" },
  cancelling: { label: "Cancelling", className: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
  completed: { label: "Completed", className: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", className: "border-destructive/40 text-destructive" },
  cancelled: { label: "Cancelled", className: "border-border text-muted-foreground" },
};

function JobCard({ jobId }: { jobId: string }) {
  const job = useJobs((s) => s.jobs.find((j) => j.id === jobId));
  const cancel = useJobs((s) => s.cancel);
  const removeJob = useJobs((s) => s.removeJob);
  const [open, setOpen] = useState(false);
  if (!job) return null;

  const active = ["queued", "preparing", "running", "cancelling"].includes(job.state);
  const badge = STATE_BADGE[job.state];
  const elapsed =
    job.startedAt && job.endedAt
      ? `${((job.endedAt - job.startedAt) / 1000).toFixed(1)}s`
      : job.startedAt
        ? `${((Date.now() - job.startedAt) / 1000).toFixed(0)}s…`
        : null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("shrink-0", badge.className)}>{badge.label}</Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{job.label}</p>
            <p className="text-[11px] text-muted-foreground">
              {job.type} · started {new Date(job.createdAt).toLocaleTimeString()}
              {elapsed ? ` · ${elapsed}` : ""}
              {job.stage ? ` · ${job.stage}` : ""}
              {job.progress !== null ? ` · ${Math.round(job.progress * 100)}%` : job.state === "running" ? " · indeterminate" : ""}
            </p>
          </div>
          {active && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => cancel(job.id)} aria-label="Cancel job">
              <XCircle className="h-4 w-4" aria-hidden />
            </Button>
          )}
          {job.state === "completed" && job.result && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => downloadResult(job.result!.url, job.result!.name)}
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> Save {formatBytes(job.result.size)}
            </Button>
          )}
          {!active && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeJob(job.id)} aria-label="Remove job from list">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
            aria-expanded={open}
            aria-label="Toggle job log"
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
        </div>

        {active && (
          <div className="mt-3">
            {job.progress !== null ? (
              <Progress value={job.progress * 100} className="h-1.5" />
            ) : (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
              </div>
            )}
          </div>
        )}

        {job.state === "failed" && job.error && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs">
            <p className="font-medium text-destructive">[{job.error.code}]</p>
            <p className="mt-0.5 text-destructive/90">{job.error.message}</p>
          </div>
        )}
        {job.state === "cancelled" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Cancelled — partial output was discarded and never presented as a completed export.
          </p>
        )}

        {open && (
          <div className="studio-scroll mt-3 max-h-40 overflow-y-auto rounded-lg bg-muted/50 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {job.logs.length === 0 ? (
              <p>No log entries yet.</p>
            ) : (
              job.logs.map((l, i) => (
                <p key={i}>
                  <span className="text-muted-foreground/60">{new Date(l.t).toLocaleTimeString()} </span>
                  {l.msg}
                </p>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function QueueView() {
  const jobs = useJobs((s) => s.jobs);
  const clearFinished = useJobs((s) => s.clearFinished);
  const active = jobs.filter((j) => ["queued", "preparing", "running", "cancelling"].includes(j.state));
  const finished = jobs.filter((j) => !["queued", "preparing", "running", "cancelling"].includes(j.state)).slice().reverse();

  return (
    <div>
      <PageHeader
        title="Processing Queue"
        description="All heavy operations run here, isolated from page navigation. Progress is real (or explicitly indeterminate); cancellation is enforced via abort signals."
        actions={
          finished.length > 0 ? (
            <Button variant="outline" size="sm" onClick={clearFinished} className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear finished
            </Button>
          ) : undefined
        }
      />

      {jobs.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Queue is empty"
          description="Exports, conversions, and analyses appear here while they run. Start one from any workspace tool."
        />
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Active ({active.length})</h2>
              {active.map((j) => (
                <JobCard key={j.id} jobId={j.id} />
              ))}
            </section>
          )}
          {finished.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Finished ({finished.length})</h2>
              {finished.map((j) => (
                <JobCard key={j.id} jobId={j.id} />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
