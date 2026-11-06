/** Idempotent per-stem routing, shared across splitter component mounts. */
import type { Job, ModelStem } from "./types";

const active = new Set<string>();
const autoAttempted = new Set<string>();
const routedStems = new Map<string, Set<ModelStem>>();
const MAX_HISTORY = 100;

function trimHistory(): void {
  while (routedStems.size > MAX_HISTORY) {
    const oldest = routedStems.keys().next().value;
    if (!oldest) break;
    routedStems.delete(oldest);
    autoAttempted.delete(oldest);
  }
}

export function pendingStemNames(jobId: string, expected: readonly ModelStem[]): ModelStem[] {
  const imported = routedStems.get(jobId);
  return [...new Set(expected)].filter((stem) => !imported?.has(stem));
}

export function hasRoutedStemJob(jobId: string, expected: readonly ModelStem[]): boolean {
  return expected.length > 0 && pendingStemNames(jobId, expected).length === 0;
}

export function reserveStemRoute(jobId: string): boolean {
  if (!jobId || active.has(jobId)) return false;
  active.add(jobId);
  return true;
}

/** Record each successfully created lane. Unsuccessful stems remain retryable. */
export function finishStemRoute(jobId: string, added: readonly ModelStem[]): void {
  if (!active.delete(jobId)) return;
  if (!added.length) return;
  const existing = routedStems.get(jobId) ?? new Set<ModelStem>();
  for (const stem of added) existing.add(stem);
  routedStems.delete(jobId);
  routedStems.set(jobId, existing);
  trimHistory();
}

/** Attempt auto-import once, even if some stems fail, to avoid a retry loop. */
export function markAutoStemAttempt(jobId: string): boolean {
  if (!jobId || autoAttempted.has(jobId)) return false;
  autoAttempted.add(jobId);
  return true;
}

export function shouldAutoRouteStemJob(
  enabled: boolean,
  lastJobId: string | null,
  trackId: string | null,
  job: Pick<Job, "id" | "state" | "result"> | undefined,
): boolean {
  const stems = job?.result?.stemFiles?.map((entry) => entry.stem) ?? [];
  return Boolean(
    enabled && lastJobId && trackId && job && job.id === lastJobId &&
    job.state === "completed" &&
    job.result?.sourceTrackId === trackId &&
    stems.length && pendingStemNames(job.id, stems).length &&
    !active.has(job.id) && !autoAttempted.has(job.id)
  );
}
