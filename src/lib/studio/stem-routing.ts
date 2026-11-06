/**
 * One-time routing ledger for completed inference jobs.
 * Stored per renderer session (rather than per component mount) so navigating
 * away and back cannot duplicate imported DAW lanes. Bounded to the job queue.
 */
import type { Job } from "./types";

const active = new Set<string>();
const routed = new Set<string>();
const MAX_ROUTED_IDS = 100;

export function hasRoutedStemJob(jobId: string): boolean {
  return routed.has(jobId);
}

export function reserveStemRoute(jobId: string): boolean {
  if (!jobId || active.has(jobId) || routed.has(jobId)) return false;
  active.add(jobId);
  return true;
}

export function finishStemRoute(jobId: string, importedAny: boolean): void {
  if (!active.delete(jobId)) return;
  if (!importedAny) return; // Allow explicit retry after an unsuccessful import.
  routed.add(jobId);
  while (routed.size > MAX_ROUTED_IDS) {
    const oldest = routed.values().next().value;
    if (oldest === undefined) break;
    routed.delete(oldest);
  }
}

/** Auto-route only the actual completed job the user launched on this track. */
export function shouldAutoRouteStemJob(
  enabled: boolean,
  lastJobId: string | null,
  trackId: string | null,
  job: Pick<Job, "id" | "state" | "result"> | undefined,
): boolean {
  return Boolean(
    enabled && lastJobId && trackId && job && job.id === lastJobId &&
    job.state === "completed" &&
    job.result?.sourceTrackId === trackId &&
    job.result?.stemFiles?.length &&
    !active.has(job.id) && !routed.has(job.id)
  );
}
