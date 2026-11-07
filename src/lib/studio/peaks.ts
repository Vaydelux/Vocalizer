/**
 * Real decoded-audio waveform envelopes and a bounded, source-aware LRU cache.
 *
 * Peak extraction runs in bounded batches so long recordings cannot block
 * UI interaction for an entire channel. Cancellation stops work on track
 * changes/unmount; no partial results are published to the cache.
 */

export interface Peaks {
  /** Interleaved [min, max] per bucket per channel. */
  channels: Float32Array[];
  buckets: number;
  /** Fixed visual resolution (buckets per second). */
  fps: number;
  duration: number;
  sampleRate: number;
}

export const PEAKS_FPS = 40;
export const PEAK_BATCH_BUCKETS = 128;
export const MAX_PEAK_CACHE_BYTES = 32 * 1024 * 1024;

interface CachedPeaks {
  peaks: Peaks;
  sourceKey?: string;
  sizeBytes: number;
}
const cache = new Map<string, CachedPeaks>();
let cacheSizeBytes = 0;

function peakBytes(peaks: Peaks): number {
  return peaks.channels.reduce((total, channel) => total + channel.byteLength, 0);
}

/** Returns only peaks belonging to this exact source, and marks the hit recent. */
export function getCachedPeaks(trackId: string, sourceKey?: string): Peaks | undefined {
  const entry = cache.get(trackId);
  if (!entry) return undefined;
  if (sourceKey !== undefined && sourceKey !== entry.sourceKey) {
    dropPeaks(trackId);
    return undefined;
  }
  cache.delete(trackId);
  cache.set(trackId, entry);
  return entry.peaks;
}

/** Keep at most 32 MiB of float32 envelopes, evicting least-recently-used. */
export function cachePeaks(trackId: string, peaks: Peaks, sourceKey?: string): void {
  dropPeaks(trackId);
  const sizeBytes = peakBytes(peaks);
  if (sizeBytes > MAX_PEAK_CACHE_BYTES) return;
  while (cache.size && cacheSizeBytes + sizeBytes > MAX_PEAK_CACHE_BYTES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    dropPeaks(oldestKey);
  }
  cache.set(trackId, { peaks, sourceKey, sizeBytes });
  cacheSizeBytes += sizeBytes;
}

export function dropPeaks(trackId: string): void {
  const previous = cache.get(trackId);
  if (!previous) return;
  cacheSizeBytes -= previous.sizeBytes;
  cache.delete(trackId);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function prepare(buffer: AudioBuffer): Pick<Peaks, "fps" | "buckets" | "duration" | "sampleRate"> {
  const fps = PEAKS_FPS;
  if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 ||
      !Number.isSafeInteger(buffer.length) || buffer.length < 0 ||
      !Number.isSafeInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1) {
    throw new Error("Invalid decoded audio for peak extraction.");
  }
  return {
    buckets: Math.max(1, Math.ceil(buffer.duration * fps)),
    fps,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
  };
}

/** Segment by proportional sample boundaries so every sample bucket is covered. */
function fillBucket(data: Float32Array, target: Float32Array, bucket: number, buckets: number): void {
  const start = Math.floor(bucket * data.length / buckets);
  const end = Math.floor((bucket + 1) * data.length / buckets);
  if (end <= start) {
    target[bucket * 2] = 0;
    target[bucket * 2 + 1] = 0;
    return;
  }
  const stride = end - start > 4096 ? Math.floor((end - start) / 4096) : 1;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = start; index < end; index += stride) {
    const sample = data[index];
    if (sample < min) min = sample;
    if (sample > max) max = sample;
  }
  target[bucket * 2] = Number.isFinite(min) ? min : 0;
  target[bucket * 2 + 1] = Number.isFinite(max) ? max : 0;
}

/** Synchronous path for constrained fixtures and callers that explicitly need it. */
export function computePeaksSync(buffer: AudioBuffer, signal?: AbortSignal): Peaks {
  const metadata = prepare(buffer);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    throwIfAborted(signal);
    const data = buffer.getChannelData(c);
    const out = new Float32Array(metadata.buckets * 2);
    for (let b = 0; b < metadata.buckets; b++) {
      if (b % PEAK_BATCH_BUCKETS === 0) throwIfAborted(signal);
      fillBucket(data, out, b, metadata.buckets);
    }
    channels.push(out);
  }
  return { channels, ...metadata };
}

/**
 * Yields after each small group of buckets, not only between channels.
 * Even one very long mono channel stays responsive to track-change aborts.
 * The Web Audio decode itself is not interruptible; this bounds *peak work*.
 */
export async function computePeaks(buffer: AudioBuffer, signal?: AbortSignal): Promise<Peaks> {
  const metadata = prepare(buffer);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    throwIfAborted(signal);
    const data = buffer.getChannelData(c);
    const out = new Float32Array(metadata.buckets * 2);
    for (let start = 0; start < metadata.buckets; start += PEAK_BATCH_BUCKETS) {
      throwIfAborted(signal);
      const end = Math.min(metadata.buckets, start + PEAK_BATCH_BUCKETS);
      for (let b = start; b < end; b++) fillBucket(data, out, b, metadata.buckets);
      // setTimeout(0), not Promise.resolve(), lets the browser handle input.
      // Avoid scheduling a superfluous timer after the final channel.
      if (end < metadata.buckets || c + 1 < buffer.numberOfChannels) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    channels.push(out);
  }
  throwIfAborted(signal);
  return { channels, ...metadata };
}
