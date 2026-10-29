/**
 * Waveform peak extraction + in-memory cache.
 * Peaks are computed from real decoded audio; results are cached per track ID
 * so re-opening a waveform never re-decodes unnecessarily.
 */

export interface Peaks {
  /** Interleaved [min, max] per bucket per channel. */
  channels: Float32Array[];
  buckets: number;
  /** Fixed visual resolution (buckets per second) so zoom is lossless-ish without recompute. */
  fps: number;
  duration: number;
  sampleRate: number;
}

const cache = new Map<string, Peaks>();

export function getCachedPeaks(trackId: string): Peaks | undefined {
  return cache.get(trackId);
}

export function cachePeaks(trackId: string, peaks: Peaks): void {
  cache.set(trackId, peaks);
}

export function dropPeaks(trackId: string): void {
  cache.delete(trackId);
}

export const PEAKS_FPS = 40; // buckets per second

export function computePeaksSync(buffer: AudioBuffer, signal?: AbortSignal): Peaks {
  const fps = PEAKS_FPS;
  const buckets = Math.max(1, Math.ceil(buffer.duration * fps));
  const channels: Float32Array[] = [];
  const step = Math.max(1, Math.floor(buffer.length / buckets));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const data = buffer.getChannelData(c);
    const out = new Float32Array(buckets * 2);
    for (let b = 0; b < buckets; b++) {
      const start = b * step;
      const end = Math.min(start + step, data.length);
      let min = 1;
      let max = -1;
      // Stride sampling for very large buckets keeps this fast and accurate enough.
      const stride = end - start > 4096 ? Math.floor((end - start) / 4096) : 1;
      for (let i = start; i < end; i += stride) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out[b * 2] = min === 1 ? 0 : min;
      out[b * 2 + 1] = max === -1 ? 0 : max;
    }
    channels.push(out);
  }
  return { channels, buckets, fps, duration: buffer.duration, sampleRate: buffer.sampleRate };
}

/** Chunked peak computation that yields to the event loop; cancellable. */
export async function computePeaks(buffer: AudioBuffer, signal?: AbortSignal): Promise<Peaks> {
  const fps = PEAKS_FPS;
  const buckets = Math.max(1, Math.ceil(buffer.duration * fps));
  const channels: Float32Array[] = [];
  const step = Math.max(1, Math.floor(buffer.length / buckets));

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const data = buffer.getChannelData(c);
    const out = new Float32Array(buckets * 2);
    for (let b = 0; b < buckets; b++) {
      const start = b * step;
      const end = Math.min(start + step, data.length);
      let min = 1;
      let max = -1;
      const stride = end - start > 4096 ? Math.floor((end - start) / 4096) : 1;
      for (let i = start; i < end; i += stride) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out[b * 2] = min === 1 ? 0 : min;
      out[b * 2 + 1] = max === -1 ? 0 : max;
    }
    channels.push(out);
    // Yield between channels.
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return { channels, buckets, fps, duration: buffer.duration, sampleRate: buffer.sampleRate };
}
