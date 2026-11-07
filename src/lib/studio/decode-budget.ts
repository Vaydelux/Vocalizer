/**
 * Conservative Web Audio allocation gate.
 *
 * Compressed files can expand many times their on-disk size. A filename or
 * compressed byte count alone cannot establish safe decodeAudioData memory.
 * Browser media metadata provides a duration estimate before full decoding.
 *
 * This is a *guardrail*, not a proof of peak memory: codecs, channel layouts,
 * browser implementations, resampling and allocator overhead vary. Large
 * audio processing belongs on the native streaming FFmpeg path.
 */
export const MAX_DECODE_BYTES = 64 * 1024 * 1024;
export const MAX_PROJECTED_PCM_BYTES = 256 * 1024 * 1024;
export const MAX_DECODE_DURATION_SECONDS = 10 * 60;

// Assume four 48 kHz float32 channels when screening browser PCM allocation.
// This exceeds the usual two-channel stereo output for a safety margin.
const BUDGET_SAMPLE_RATE = 48_000;
const BUDGET_CHANNELS = 4;
const FLOAT32_BYTES = 4;

export function projectedBrowserPcmBytes(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return Number.POSITIVE_INFINITY;
  return durationSeconds * BUDGET_SAMPLE_RATE * BUDGET_CHANNELS * FLOAT32_BYTES;
}

/** Media-element duration must be finite before full Web Audio decode. */
export function mayDecodeBrowserAudio(fileBytes: number, measuredDurationSeconds: number | null): boolean {
  return Number.isSafeInteger(fileBytes) && fileBytes > 0 &&
    fileBytes <= MAX_DECODE_BYTES &&
    measuredDurationSeconds !== null &&
    Number.isFinite(measuredDurationSeconds) &&
    measuredDurationSeconds > 0 &&
    measuredDurationSeconds <= MAX_DECODE_DURATION_SECONDS &&
    projectedBrowserPcmBytes(measuredDurationSeconds) <= MAX_PROJECTED_PCM_BYTES;
}
