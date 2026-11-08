/**
 * Exact ownership for an in-flight native waveform request.
 *
 * Reopening the same project stem creates a new requestId. A delayed cleanup
 * from an older WavePlayer must never abort the newer request, even if both
 * requests have identical job IDs and stem names.
 */
export interface WaveformRequestIdentity {
  jobId: string;
  stem: string;
  requestId: string;
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

