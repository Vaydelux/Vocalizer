/**
 * Repeatable, model-free native stem streaming benchmark.
 *
 * The fixture is a sparse temporary file, not a copyrighted recording.
 * Only small, verified byte ranges are read; the renderer is never used.
 * Sampled process RSS is an approximate process measure, not Electron
 * renderer/private working set or an audio fidelity benchmark.
 *
 * Run: bun scripts/benchmark-stem-stream.ts --output path/to/metrics.json
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { streamVerifiedStem } from "../electron/main/services/stem-media";

const MIB = 1024 * 1024;
const FIXTURE_BYTES = 512 * MIB;
const RANGE_BYTES = 2 * MIB;
const REPEATS = 4;
const RSS_LIMIT_BYTES = 256 * MIB;

function outputArgument(): string | null {
  const index = process.argv.indexOf("--output");
  if (index < 0) return null;
  const result = process.argv[index + 1];
  if (!result || result.startsWith("--")) throw new Error("--output expects a filename.");
  return path.resolve(result);
}

async function run(): Promise<void> {
  const output = outputArgument();
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "vocalizer-stream-bench-"));
  const filename = path.join(folder, "Vocalizer-stream-benchmark-vocals.wav");
  const offsets = [0, FIXTURE_BYTES / 2, FIXTURE_BYTES - RANGE_BYTES];
  // Build a sparse file with unique marker bytes at every measured offset,
  // so the test can prove an actual seek instead of merely checking counts.
  const markers = offsets.map((_, i) => Buffer.from("VOCALIZER_RANGE_" + i));
  let peakRssBytes = process.memoryUsage().rss;
  let interval: ReturnType<typeof setInterval> | undefined;
  try {
    const file = await fs.open(filename, "wx");
    try {
      await file.truncate(FIXTURE_BYTES);
      for (let i = 0; i < offsets.length; i++) {
        await file.write(markers[i], 0, markers[i].byteLength, offsets[i]);
      }
    } finally {
      await file.close();
    }

    // Electron's privileged completed-stem registry only exposes canonical
    // realpaths. Windows temporary directories can have a differently-cased
    // or junction-resolved spelling, so mirror production resolution here.
    const verifiedPath = await fs.realpath(filename);

    // Verify native HEAD and unsatisfiable range semantics without reading
    // the 512 MiB body. These controls are excluded from timed throughput.
    const controlUrl = "https://renderer.local/__stem-audio/benchmark/Vocals";
    const head = await streamVerifiedStem(new Request(controlUrl, {
      method: "HEAD", headers: { Range: "bytes=0-63" },
    }), verifiedPath);
    if (head.status !== 206 || head.body !== null ||
        head.headers.get("Content-Range") !== `bytes 0-63/${FIXTURE_BYTES}`) {
      throw new Error(`Native HEAD byte-range validation failed: status=${head.status}, body=${head.body !== null}, range=${head.headers.get("Content-Range")}`);
    }
    const unsatisfiable = await streamVerifiedStem(new Request(controlUrl, {
      headers: { Range: `bytes=${FIXTURE_BYTES}-` },
    }), verifiedPath);
    if (unsatisfiable.status !== 416 ||
        unsatisfiable.headers.get("Content-Range") !== `bytes */${FIXTURE_BYTES}`) {
      throw new Error(`Native 416 byte-range validation failed: status=${unsatisfiable.status}, range=${unsatisfiable.headers.get("Content-Range")}`);
    }

    // Deliberately record a *post-setup* baseline to exclude fixture creation.
    const baselineRssBytes = process.memoryUsage().rss;
    peakRssBytes = baselineRssBytes;
    const startedAt = performance.now();
    const cpuStart = process.cpuUsage();
    interval = setInterval(() => {
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }, 5);
    interval.unref?.();

    let requests = 0;
    let totalBytesReceived = 0;
    for (let iteration = 0; iteration < REPEATS; iteration++) {
      for (let i = 0; i < offsets.length; i++) {
        const start = offsets[i];
        const end = start + RANGE_BYTES - 1;
        const request = new Request("https://renderer.local/__stem-audio/benchmark/Vocals", {
          headers: { Range: `bytes=${start}-${end}` },
        });
        const response = await streamVerifiedStem(request, verifiedPath);
        if (response.status !== 206 ||
            response.headers.get("Content-Range") !== `bytes ${start}-${end}/${FIXTURE_BYTES}` ||
            response.headers.get("Content-Length") !== String(RANGE_BYTES) ||
            !response.body) {
          throw new Error(`Incorrect byte-range response at offset ${start}.`);
        }
        // Build expected digest from exactly a 2 MiB sample window.
        const expected = Buffer.alloc(RANGE_BYTES);
        markers[i].copy(expected);
        const expectedSha256 = createHash("sha256").update(expected).digest("hex");

        const reader = response.body.getReader();
        const hash = createHash("sha256");
        let count = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            count += value.byteLength;
            if (count > RANGE_BYTES) throw new Error("Unbounded stream response.");
            hash.update(value);
          }
        } finally {
          reader.releaseLock();
        }
        if (count !== RANGE_BYTES || hash.digest("hex") !== expectedSha256) {
          throw new Error(`Source seek content mismatch at offset ${start}.`);
        }
        requests++;
        totalBytesReceived += count;
      }
    }
    if (interval) clearInterval(interval);
    interval = undefined;
    const wallMs = performance.now() - startedAt;
    const cpu = process.cpuUsage(cpuStart);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    const rssIncreaseBytes = Math.max(0, peakRssBytes - baselineRssBytes);
    const metrics = {
      schemaVersion: 1,
      label: "Synthetic sparse-file native streaming (not real-music quality)",
      commit: process.env.GITHUB_SHA ?? null,
      platform: process.platform,
      node: process.version,
      fixtureBytes: FIXTURE_BYTES,
      rangeBytes: RANGE_BYTES,
      requests,
      totalBytesReceived,
      baselineRssBytes,
      sampledPeakRssBytes: peakRssBytes,
      sampledRssIncreaseBytes: rssIncreaseBytes,
      rssLimitBytes: RSS_LIMIT_BYTES,
      wallMilliseconds: Math.round(wallMs * 100) / 100,
      cpuUserMilliseconds: Math.round(cpu.user / 1000),
      cpuSystemMilliseconds: Math.round(cpu.system / 1000),
    };
    if (output) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, JSON.stringify(metrics, null, 2) + "\n", "utf8");
    }
    console.log(JSON.stringify(metrics, null, 2));
    // Generous guardrail, not a promise of fixed resident RAM across machines.
    if (rssIncreaseBytes > RSS_LIMIT_BYTES) {
      throw new Error("Native stem streaming exceeded 256 MiB sampled RSS increase.");
    }
  } finally {
    if (interval) clearInterval(interval);
    await fs.rm(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
