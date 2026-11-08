/**
 * Bounded native waveform envelope collector.
 *
 * FFmpeg is configured to emit mono 8 kHz float32 PCM. This module never
 * materializes the recording: it reduces each incoming chunk to 40 Hz
 * min/max amplitude pairs and derives 10 Hz and 2 Hz overview levels.
 *
 * Pure/isomorphic: can be exercised by Bun tests without Electron or FFmpeg.
 */
export const NATIVE_PEAK_SAMPLE_RATE = 8_000;
export const NATIVE_PEAK_BASE_FPS = 40;
export const NATIVE_PEAK_MAX_DURATION = 4 * 60 * 60;
export const NATIVE_PEAK_LEVELS = [40, 10, 2] as const;

export interface NativePeakLevel {
  fps: number;
  buckets: number;
  /** Interleaved signed amplitude [min,max] for one mono visual channel. */
  minMax: Float32Array;
}

export interface NativeWaveformResult {
  duration: number;
  sampleRate: number;
  levels: NativePeakLevel[];
  /** Whether main reused a verified, integrity-checked local cache entry. */
  cacheHit?: boolean;
}

export function aggregatePeakLevel(input: NativePeakLevel, targetFps: number): NativePeakLevel {
  const ratio = input.fps / targetFps;
  if (!Number.isSafeInteger(ratio) || ratio < 1 ||
      !Number.isFinite(targetFps) || targetFps <= 0) {
    throw new Error("Invalid waveform downsampling factor.");
  }
  const buckets = Math.ceil(input.buckets / ratio);
  const minMax = new Float32Array(buckets * 2);
  for (let dest = 0; dest < buckets; dest++) {
    const from = dest * ratio;
    const to = Math.min(input.buckets, from + ratio);
    let lo = 0;
    let hi = 0;
    for (let src = from; src < to; src++) {
      lo = Math.min(lo, input.minMax[src * 2]);
      hi = Math.max(hi, input.minMax[src * 2 + 1]);
    }
    minMax[dest * 2] = lo;
    minMax[dest * 2 + 1] = hi;
  }
  return { fps: targetFps, buckets, minMax };
}

export function chooseNativePeakLevel(levels: NativePeakLevel[], pixelsPerSecond: number): NativePeakLevel {
  if (!levels.length) throw new Error("No waveform levels available.");
  const sorted = [...levels].sort((a, b) => a.fps - b.fps);
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return sorted[0];
  return sorted.find(level => level.fps >= pixelsPerSecond) ?? sorted[sorted.length - 1];
}

export class NativePeakCollector {
  private readonly capacity: number;
  private readonly samplesPerBucket = NATIVE_PEAK_SAMPLE_RATE / NATIVE_PEAK_BASE_FPS;
  private readonly peaks: Float32Array;
  private pending = Buffer.alloc(0);
  private samples = 0;
  private bucket = -1;
  private min = 0;
  private max = 0;

  constructor(private readonly expectedDuration: number) {
    if (!Number.isFinite(expectedDuration) || expectedDuration <= 0 ||
        expectedDuration > NATIVE_PEAK_MAX_DURATION) {
      throw new Error("Native waveform duration is unavailable or exceeds four hours.");
    }
    // Give FFprobe's rounded container duration 2 seconds of slack.
    this.capacity = Math.ceil((expectedDuration + 2) * NATIVE_PEAK_BASE_FPS);
    this.peaks = new Float32Array(this.capacity * 2);
  }

  write(bytes: Buffer): void {
    const input = this.pending.length ? Buffer.concat([this.pending, bytes]) : bytes;
    const completeBytes = input.length - input.length % 4;
    for (let offset = 0; offset < completeBytes; offset += 4) {
      const index = Math.floor(this.samples / this.samplesPerBucket);
      if (index >= this.capacity) throw new Error("Decoded waveform exceeded approved duration.");
      if (index !== this.bucket) {
        if (this.bucket >= 0) this.flush();
        this.bucket = index;
        this.min = 0;
        this.max = 0;
      }
      const sample = input.readFloatLE(offset);
      if (Number.isFinite(sample)) {
        this.min = Math.min(this.min, sample);
        this.max = Math.max(this.max, sample);
      }
      this.samples++;
    }
    this.pending = completeBytes < input.length ? Buffer.from(input.subarray(completeBytes)) : Buffer.alloc(0);
  }

  private flush(): void {
    this.peaks[this.bucket * 2] = this.min;
    this.peaks[this.bucket * 2 + 1] = this.max;
  }

  finish(): NativeWaveformResult {
    if (this.pending.length || this.samples === 0) {
      throw new Error("Decoded waveform has incomplete or no PCM samples.");
    }
    this.flush();
    const buckets = this.bucket + 1;
    const high: NativePeakLevel = {
      fps: NATIVE_PEAK_BASE_FPS,
      buckets,
      minMax: this.peaks.slice(0, buckets * 2),
    };
    return {
      duration: this.expectedDuration,
      sampleRate: NATIVE_PEAK_SAMPLE_RATE,
      levels: [
        high,
        aggregatePeakLevel(high, 10),
        aggregatePeakLevel(high, 2),
      ],
    };
  }
}
