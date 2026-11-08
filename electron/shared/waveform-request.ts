/**
 * Exact ownership for an in-flight native waveform request.
 *
 * Reopening the same project stem creates a new requestId. An old player's
 * delayed cleanup must not cancel a replacement, even for an identical stem.
 */
export interface WaveformRequestIdentity {
  jobId: string;
  stem: string;
  requestId: string;
}

export interface ActiveWaveformRequest {
  request: WaveformRequestIdentity;
  controller: AbortController;
}

export function sameWaveformRequest(
  active: WaveformRequestIdentity | null,
  incoming: WaveformRequestIdentity,
): boolean {
  return active !== null &&
    active.jobId === incoming.jobId &&
    active.stem === incoming.stem &&
    active.requestId === incoming.requestId;
}

/**
 * Single active native decoder; start() must be called before any async
 * source validation so pending registry lookups are cancellable as well.
 *
 * finish() is identity-based: a late finally from an old request cannot
 * clear the ownership of a newer request.
 */
export class WaveformRequestCoordinator {
  private active: ActiveWaveformRequest | null = null;

  start(request: WaveformRequestIdentity): ActiveWaveformRequest {
    this.active?.controller.abort();
    const task = { request, controller: new AbortController() };
    this.active = task;
    return task;
  }

  cancel(request: WaveformRequestIdentity): boolean {
    if (!sameWaveformRequest(this.active?.request ?? null, request)) {
      return false;
    }
    this.active?.controller.abort();
    return true;
  }

  finish(task: ActiveWaveformRequest): void {
    if (this.active === task) this.active = null;
  }
}
