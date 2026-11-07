/**
 * Model-free synthetic waveform benchmark.
 *
 * Measures the new incremental peak extractor's throughput and event-loop
 * yielding. It does not measure decodeAudioData, Electron renderer/GPU memory,
 * real song quality, or native FFmpeg peak generation.
 *
 * Run: bun scripts/benchmark-peaks.ts --output reports/peak-benchmark.json
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { computePeaks, computePeaksSync, PEAK_BATCH_BUCKETS, PEAKS_FPS } from "../src/lib/studio/peaks";

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 90;
const CHANNELS = 2;
const EXPECTED_SAMPLES = SAMPLE_RATE * DURATION_SECONDS;
const MEMORY_GUARD_BYTES = 96 * 1024 * 1024;
const TIME_GUARD_MS = 45_000;

function outputPath(): string | null {
  const i = process.argv.indexOf("--output");
  if (i < 0) return null;
  const output = process.argv[i + 1];
  if (!output || output.startsWith("--")) throw new Error("--output requires a path");
  return path.resolve(output);
}

function fixture(): AudioBuffer {
  const channelData = Array.from({ length: CHANNELS }, (_, channel) => {
    const data = new Float32Array(EXPECTED_SAMPLES);
    // Deterministic periodic samples with extrema in every bucket.
    for (let i = 0; i < EXPECTED_SAMPLES; i++) {
      data[i] = ((i + channel * 59) % 512 < 256 ? -0.65 : 0.8) * (channel === 0 ? 1 : 0.5);
    }
    return data;
  });
  return {
    duration: DURATION_SECONDS,
    length: EXPECTED_SAMPLES,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: CHANNELS,
    getChannelData: (channel: number) => {
      if (channel < 0 || channel >= CHANNELS) throw new Error("channel out of range");
      return channelData[channel];
    },
  } as AudioBuffer;
}

function digest(data: Float32Array[]): string {
  const hash = createHash("sha256");
  for (const channel of data) {
    hash.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
  }
  return hash.digest("hex");
}

async function benchmark(): Promise<void> {
  const buffer = fixture();
  const baselineRssBytes = process.memoryUsage().rss;
  let sampledPeakRssBytes = baselineRssBytes;
  let eventLoopTicks = 0;
  const interval = setInterval(() => {
    eventLoopTicks++;
    sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss);
  }, 5);
  interval.unref?.();

  let extracted: Awaited<ReturnType<typeof computePeaks>>;
  let elapsedMs: number;
  let cpuUserMilliseconds: number;
  let cpuSystemMilliseconds: number;
  try {
    const started = performance.now();
    const cpuStart = process.cpuUsage();
    extracted = await computePeaks(buffer);
    elapsedMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuStart);
    cpuUserMilliseconds = cpu.user / 1000;
    cpuSystemMilliseconds = cpu.system / 1000;
  } finally {
    clearInterval(interval);
  }
  sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss);
  const expected = computePeaksSync(buffer);
  if (extracted.buckets !== expected.buckets ||
      extracted.channels.length !== expected.channels.length ||
      digest(extracted.channels) !== digest(expected.channels)) {
    throw new Error("Incremental peak result differs from synchronous reference");
  }
  const sampledRssIncreaseBytes = Math.max(0, sampledPeakRssBytes - baselineRssBytes);
  const peakArrayBytes = extracted.channels.reduce((total, c) => total + c.byteLength, 0);
  const report = {
    schemaVersion: 1,
    label: "Synthetic in-memory Float32 peak processing; not audio playback",
    commit: process.env.GITHUB_SHA ?? null,
    platform: process.platform,
    runtime: process.version,
    durationSeconds: DURATION_SECONDS,
    channels: CHANNELS,
    sampleRate: SAMPLE_RATE,
    sampleCountPerChannel: EXPECTED_SAMPLES,
    peakBucketsPerChannel: extracted.buckets,
    targetBucketsPerSecond: PEAKS_FPS,
    batchBuckets: PEAK_BATCH_BUCKETS,
    peakArrayBytes,
    sha256: digest(extracted.channels),
    elapsedMilliseconds: Math.round(elapsedMs * 100) / 100,
    cpuUserMilliseconds: Math.round(cpuUserMilliseconds * 100) / 100,
    cpuSystemMilliseconds: Math.round(cpuSystemMilliseconds * 100) / 100,
    eventLoopTicks,
    baselineRssBytes,
    sampledPeakRssBytes,
    sampledRssIncreaseBytes,
    rssGuardBytes: MEMORY_GUARD_BYTES,
  };
  const output = outputPath();
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
  if (eventLoopTicks < 1) throw new Error("Peak worker never yielded to the event loop");
  if (elapsedMs > TIME_GUARD_MS) throw new Error("Peak extraction exceeded 45-second regression guard");
  if (sampledRssIncreaseBytes > MEMORY_GUARD_BYTES) {
    throw new Error("Peak extraction exceeded 96 MiB sampled RSS increase");
  }
}

benchmark().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
