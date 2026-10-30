"use client";

/**
 * Inline job row — real progress (or honest indeterminate), cancel, download,
 * and typed error display for a single queued job.
 */

import { Download, LoaderCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useJobs } from "@/lib/studio/store-jobs";
import { openJobResult } from "@/lib/studio/open-result";
import { formatBytes } from "@/lib/studio/format";

export function InlineJob({ jobId, className }: { jobId: string; className?: string }) {
  const job = useJobs((s) => s.jobs.find((j) => j.id === jobId));
  const cancel = useJobs((s) => s.cancel);
  if (!job) return null;

  const active = ["queued", "preparing", "running", "cancelling"].includes(job.state);

  return (
    <div className={`rounded-lg border border-border bg-card p-3 text-sm ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        {active ? (
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
        ) : job.state === "completed" ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{job.label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {job.stage ?? job.state}
          {job.progress !== null ? ` · ${Math.round(job.progress * 100)}%` : ""}
        </span>
        {active && job.state !== "cancelling" && (
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Cancel job" onClick={() => cancel(job.id)}>
            <XCircle className="h-4 w-4" aria-hidden />
          </Button>
        )}
        {job.state === "completed" && job.result && (
          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void openJobResult(job)}
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> {job.result.nativePath ? "Show output" : job.result.stemFiles ? "Save stem manifest" : `Save (${formatBytes(job.result.size)})`}
          </Button>
        )}
      </div>
      {active && (
        <div className="mt-2">
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
        <p className="mt-1.5 text-xs text-destructive">
          [{job.error.code}] {job.error.message}
        </p>
      )}
    </div>
  );
}
