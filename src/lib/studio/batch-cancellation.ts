/** Tracks only native queue jobs started by this batch run. */
export class BatchJobRegistry {
  private readonly jobs = new Set<string>();
  private readonly controller = new AbortController();
  private readonly cancelJob: (id: string) => void;

  constructor(cancelJob: (id: string) => void) {
    this.cancelJob = cancelJob;
  }

  get signal(): AbortSignal { return this.controller.signal; }
  get activeCount(): number { return this.jobs.size; }

  track(id: string): void {
    this.jobs.add(id);
    // Covers cancellation between enqueue and registration.
    if (this.signal.aborted) this.cancelJob(id);
  }

  finish(id: string): void {
    this.jobs.delete(id);
  }

  cancel(): void {
    if (this.signal.aborted) return;
    this.controller.abort();
    for (const id of this.jobs) this.cancelJob(id);
  }
}
