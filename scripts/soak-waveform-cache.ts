/**
 * Synthetic long-duration waveform cache soak.
 *
 * Exercises repeated disk reopen, checksum recovery and source invalidation.
 * This fixture is 90 minutes of synthetic PEAK DATA, not 90 minutes of audio
 * decoding. It does NOT benchmark FFmpeg, Chromium or a real GUI session.
 *
 * Run: bun scripts/soak-waveform-cache.ts --output reports/cache-soak.json
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import {
  aggregatePeakLevel,
  type NativePeakLevel,
  type NativeWaveformResult,
} from "../electron/shared/native-waveform";
import {
  identifyNativeWaveformSource,
  readNativeWaveformCache,
  writeNativeWaveformCache,
} from "../electron/main/services/waveform-cache";

const DURATION_SECONDS = 90 * 60;
const REOPEN_COUNT = 20;
const RSS_LIMIT_BYTES = 160 * 1024 * 1024;
const WALL_LIMIT_MS = 45_000;

function outputArgument(): string | null {
  const index = process.argv.indexOf("--output");
  if (index === -1) return null;
  const name = process.argv[index + 1];
  if (!name || name.startsWith("--")) throw new Error("--output expects a filename");
  return path.resolve(name);
}

function syntheticWaveform(): NativeWaveformResult {
  const buckets = DURATION_SECONDS * 40;
  const minMax = new Float32Array(buckets * 2);
  for (let i = 0; i < buckets; i++) {
    // Deterministic synthetic amplitudes, including occasional pronounced
    // transients, without relying on the host's media decoders.
    const a = Math.abs(Math.sin(i * 0.007)) * 0.7;
    const transient = i % 997 === 0 ? 0.96 : a;
    minMax[i * 2] = -transient;
    minMax[i * 2 + 1] = transient;
  }
  const high: NativePeakLevel = { fps: 40, buckets, minMax };
  return {
    duration: DURATION_SECONDS,
    sampleRate: 8_000,
    levels: [high, aggregatePeakLevel(high, 10), aggregatePeakLevel(high, 2)],
  };
}

function digestWaveform(value: NativeWaveformResult): string {
  const hash = createHash("sha256");
  for (const level of value.levels) {
    hash.update(Buffer.from(level.minMax.buffer, level.minMax.byteOffset, level.minMax.byteLength));
  }
  return hash.digest("hex");
}

async function run(): Promise<void> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "vocalizer-cache-soak-"));
  let sampler: ReturnType<typeof setInterval> | undefined;
  try {
    const source = path.join(folder, "Synthetic-Verified-Vocals.wav");
    const root = path.join(folder, "waveform-cache");
    // A small synthetic source identity is sufficient for cache lifecycle
    // testing; the 90-minute timeline is encoded in the peak fixture.
    await fs.writeFile(source, Buffer.alloc(4096, 41));
    const signature = await identifyNativeWaveformSource(await fs.realpath(source));
    const peaks = syntheticWaveform();
    const expectedDigest = digestWaveform(peaks);

    const baselineRssBytes = process.memoryUsage().rss;
    let sampledPeakRssBytes = baselineRssBytes;
    let eventLoopTicks = 0;
    sampler = setInterval(() => {
      eventLoopTicks++;
      sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss);
    }, 5);
    sampler.unref?.();

    const started = performance.now();
    const cpuStart = process.cpuUsage();
    await writeNativeWaveformCache(root, signature, peaks);
    let verifiedCacheHits = 0;
    for (let i = 0; i < REOPEN_COUNT; i++) {
      const cached = await readNativeWaveformCache(root, signature);
      if (!cached || cached.levels.length !== 3 ||
          digestWaveform(cached) !== expectedDigest) {
        throw new Error("Disk cache reopen returned missing or corrupted waveform data");
      }
      verifiedCacheHits++;
    }

    const entries = await fs.readdir(root);
    const filename = entries.find(name => /^[0-9a-f]{64}\.peak$/.test(name));
    if (!filename) throw new Error("Waveform cache entry was not created");
    const pathname = path.join(root, filename);
    const damaged = await fs.readFile(pathname);
    damaged[damaged.length - 1] ^= 0xff;
    await fs.writeFile(pathname, damaged);
    if (await readNativeWaveformCache(root, signature)) {
      throw new Error("Tampered peak data unexpectedly passed checksum validation");
    }

    await writeNativeWaveformCache(root, signature, peaks);
    const recovered = await readNativeWaveformCache(root, signature);
    if (!recovered || digestWaveform(recovered) !== expectedDigest) {
      throw new Error("Cache failed to recover after corruption");
    }

    // Changing the physical source must invalidate old cache entries.
    await fs.appendFile(source, Buffer.from([99]));
    const changed = await identifyNativeWaveformSource(await fs.realpath(source));
    if (await readNativeWaveformCache(root, changed)) {
      throw new Error("Modified source reused an obsolete waveform cache entry");
    }

    const wallMilliseconds = performance.now() - started;
    const cpu = process.cpuUsage(cpuStart);
    if (sampler) clearInterval(sampler);
    sampler = undefined;
    sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss);
    const sampledRssIncreaseBytes = Math.max(0, sampledPeakRssBytes - baselineRssBytes);
    const report = {
      schemaVersion: 1,
      label: "Synthetic 90-minute waveform cache soak (no media decode, no GUI)",
      commit: process.env.GITHUB_SHA ?? null,
      platform: process.platform,
      node: process.version,
      durationSeconds: DURATION_SECONDS,
      reopenedEntries: verifiedCacheHits,
      checksumCorruptionRejected: true,
      cacheRecoveryPassed: true,
      modifiedSourceInvalidated: true,
      eventLoopTicks,
      wallMilliseconds: Math.round(wallMilliseconds * 100) / 100,
      cpuUserMilliseconds: Math.round(cpu.user / 1000),
      cpuSystemMilliseconds: Math.round(cpu.system / 1000),
      peakDataBytes: peaks.levels.reduce((sum, level) => sum + level.minMax.byteLength, 0),
      baselineRssBytes,
      sampledPeakRssBytes,
      sampledRssIncreaseBytes,
      rssGuardBytes: RSS_LIMIT_BYTES,
    };
    const output = outputArgument();
    if (output) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
    }
    console.log(JSON.stringify(report, null, 2));
    if (eventLoopTicks < 1) throw new Error("Soak test never yielded to the event loop");
    if (wallMilliseconds > WALL_LIMIT_MS) throw new Error("Waveform cache soak exceeded 45-second guardrail");
    if (sampledRssIncreaseBytes > RSS_LIMIT_BYTES) {
      throw new Error("Waveform cache reopen exceeded 160 MiB sampled process memory growth");
    }
  } finally {
    if (sampler) clearInterval(sampler);
    await fs.rm(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
