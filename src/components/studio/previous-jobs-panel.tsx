"use client";

import { useState } from "react";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { previousJobReceipts, clearJobReceipts, type JobReceipt } from "@/lib/studio/job-journal";

/** Read-only metadata from earlier app sessions. Never implies outputs remain
 * available or that an interrupted encode can automatically resume. */
export function PreviousJobsPanel() {
  const [history, setHistory] = useState<JobReceipt[] | null>(null);
  const refresh = () => setHistory(previousJobReceipts());
  return (
    <section className="mt-6 space-y-3 border-t border-border pt-5" aria-label="Previous job sessions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" aria-hidden /> Previous sessions</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Saved job status only. Media files and incomplete jobs are not restored automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> View history
          </Button>
          {history && history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => {
              clearJobReceipts();
              setHistory([]);
            }}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear history
            </Button>
          )}
        </div>
      </div>
      {history !== null && (
        history.length === 0 ? <p role="status" className="text-xs text-muted-foreground">No earlier job receipts found.</p> :
        <ul className="space-y-2">
          {history.slice(0, 15).map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-xs">
              <span className="shrink-0 rounded-md bg-muted px-2 py-1 font-medium">{job.state === "interrupted" ? "Interrupted — not resumed" : job.state}</span>
              <span className="min-w-0 flex-1 break-words">{job.label}</span>
              <time className="text-muted-foreground" dateTime={new Date(job.createdAt).toISOString()}>
                {new Date(job.createdAt).toLocaleDateString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
