import { afterEach, describe, expect, it } from "bun:test";
import {
  cachePeaks,
  computePeaks,
  computePeaksSync,
  dropPeaks,
  getCachedPeaks,
  MAX_PEAK_CACHE_BYTES,
  PEAK_BATCH_BUCKETS,
  PEAKS_FPS,
  type Peaks,
} from "../../src/lib/studio/peaks";

function fakeAudio(duration: number, samples: Float32Array[]): AudioBuffer {
  return {
    duration,
    length: samples[0]?.length ?? 0,
    sampleRate: 44100,
    numberOfChannels: samples.length,
    getChannelData: (channel: number) => samples[channel],
  } as unknown as AudioBuffer;
}

function mockPeaks(bytes: number): Peaks {
  return {
    channels: [new Float32Array(bytes / Float32Array.BYTES_PER_ELEMENT)],
    buckets: 1,
    fps: PEAKS_FPS,
    duration: 1,
    sampleRate: 44100,
  };
}

describe("incremental waveform peak extraction", () => {
  it("retains the first and last samples and agrees with synchronous extraction", async () => {
    const channel = new Float32Array(500);
    channel[0] = -0.85;
    channel[9] = 0.9;
    channel[499] = -0.95;
    const input = fakeAudio(0.25, [channel]); // 10 buckets at 40 fps
    const a = computePeaksSync(input);
    const b = await computePeaks(input);
    expect(b).toEqual(a);
    expect(b.buckets).toBe(10);
    expect(b.channels[0][0]).toBeCloseTo(-0.85);
    expect(b.channels[0][1]).toBeCloseTo(0.9);
    expect(b.channels[0][18]).toBeCloseTo(-0.95);
  });

  it("supports mono and multi-channel recordings with fewer samples than buckets", async () => {
    const input = fakeAudio(0.2, [
      Float32Array.from([-0.4, 0.5]),
      Float32Array.from([0.6, -0.7]),
    ]);
    const result = await computePeaks(input);
    expect(result.channels.length).toBe(2);
    expect(result.buckets).toBe(8);
    expect(result.channels[0].every(Number.isFinite)).toBe(true);
    expect(result.channels[1].every(Number.isFinite)).toBe(true);
  });

  it("honors an already aborted signal before touching decoded channel samples", async () => {
    let reads = 0;
    const input = {
      duration: 60,
      numberOfChannels: 1,
      length: 20_000,
      sampleRate: 44100,
      getChannelData: () => { reads++; return new Float32Array(20_000); },
    } as unknown as AudioBuffer;
    const controller = new AbortController();
    controller.abort();
    await expect(computePeaks(input, controller.signal)).rejects.toHaveProperty("name", "AbortError");
    expect(reads).toBe(0);
  });

  it("stops a long mono channel after yielding between bounded batches", async () => {
    const controller = new AbortController();
    const channel = new Float32Array(800_000);
    const operation = computePeaks(fakeAudio(30, [channel]), controller.signal);
    // The first peak batch has run, but 30s x 40fps requires many batches.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(operation).rejects.toHaveProperty("name", "AbortError");
    expect(PEAK_BATCH_BUCKETS).toBeLessThan(30 * PEAKS_FPS);
  });
});

describe("bounded source-aware waveform peak cache", () => {
  const keys: string[] = [];
  const store = (key: string, value: Peaks, url = "blob:source") => {
    keys.push(key);
    cachePeaks(key, value, url);
  };
  afterEach(() => {
    for (const key of keys) dropPeaks(key);
    keys.length = 0;
  });

  it("does not reuse stale peaks when a project track URL changes", () => {
    const peaks = mockPeaks(1024);
    store("relinked-track", peaks, "blob:old");
    expect(getCachedPeaks("relinked-track", "blob:old")).toBe(peaks);
    expect(getCachedPeaks("relinked-track", "las://renderer/new-source")).toBeUndefined();
    expect(getCachedPeaks("relinked-track", "blob:old")).toBeUndefined();
  });

  it("evicts LRU entries after 32 MiB instead of retaining every opened track", () => {
    const oneMiB = 1024 * 1024;
    expect(MAX_PEAK_CACHE_BYTES).toBe(32 * oneMiB);
    for (let i = 0; i < 32; i++) store(`peak-${i}`, mockPeaks(oneMiB));
    expect(getCachedPeaks("peak-0", "blob:source")).toBeDefined(); // recent
    store("peak-32", mockPeaks(oneMiB));
    store("peak-33", mockPeaks(oneMiB));
    expect(getCachedPeaks("peak-0", "blob:source")).toBeDefined();
    expect(getCachedPeaks("peak-1", "blob:source")).toBeUndefined();
    expect(getCachedPeaks("peak-2", "blob:source")).toBeUndefined();
    expect(getCachedPeaks("peak-33", "blob:source")).toBeDefined();
  });

  it("does not cache an individual envelope larger than the entire budget", () => {
    store("oversized-peaks", mockPeaks(MAX_PEAK_CACHE_BYTES + 4));
    expect(getCachedPeaks("oversized-peaks", "blob:source")).toBeUndefined();
  });
});
