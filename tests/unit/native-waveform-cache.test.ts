import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  identifyNativeWaveformSource,
  nativeWaveformFingerprint,
  encodeNativeWaveformCache,
  decodeNativeWaveformCache,
  readNativeWaveformCache,
  writeNativeWaveformCache,
  planNativeWaveformEvictions,
} from "../../electron/main/services/waveform-cache";
import type { NativeWaveformResult } from "../../electron/shared/native-waveform";

let dir: string;
let sourceFile: string;
const fixture = (): NativeWaveformResult => ({
  duration: 0.05,
  sampleRate: 8000,
  levels: [
    { fps: 40, buckets: 2, minMax: Float32Array.from([-0.8, 0.9, -0.6, 0.7]) },
    { fps: 10, buckets: 1, minMax: Float32Array.from([-0.8, 0.9]) },
    { fps: 2, buckets: 1, minMax: Float32Array.from([-0.8, 0.9]) },
  ],
});

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vocalizer-wave-cache-"));
  sourceFile = path.join(dir, "Verified-Vocals.wav");
  await fs.writeFile(sourceFile, Buffer.alloc(128, 11));
});
afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});

describe("persistent native waveform cache", () => {
  it("round trips all three visual levels with a strong payload checksum", async () => {
    const src = await identifyNativeWaveformSource(await fs.realpath(sourceFile));
    const bytes = encodeNativeWaveformCache(src, fixture());
    const decoded = decodeNativeWaveformCache(src, bytes);
    expect(decoded.duration).toBeCloseTo(0.05);
    expect(decoded.levels.map(x => x.fps)).toEqual([40, 10, 2]);
    expect(decoded.levels[0].minMax[0]).toBeCloseTo(-0.8);
    expect(decoded.levels[0].minMax[1]).toBeCloseTo(0.9);
    expect(decoded.levels[0].minMax[2]).toBeCloseTo(-0.6);
    expect(decoded.levels[1].minMax.length).toBe(2);
  });

  it("atomically writes one private cache entry and reopens it", async () => {
    const root = path.join(dir, "cache-ok");
    const src = await identifyNativeWaveformSource(await fs.realpath(sourceFile));
    await writeNativeWaveformCache(root, src, fixture());
    const files = await fs.readdir(root);
    expect(files).toEqual([nativeWaveformFingerprint(src).toString("hex") + ".peak"]);
    const hit = await readNativeWaveformCache(root, src);
    expect(hit?.levels[0].minMax[0]).toBeCloseTo(-0.8);
    await writeNativeWaveformCache(root, src, fixture());
    expect((await fs.readdir(root)).length).toBe(1);
  });

  it("treats tampered payload bytes and mismatched source identity as misses", async () => {
    const root = path.join(dir, "cache-corrupted");
    const src = await identifyNativeWaveformSource(await fs.realpath(sourceFile));
    await writeNativeWaveformCache(root, src, fixture());
    const p = path.join(root, (await fs.readdir(root))[0]);
    const corrupt = await fs.readFile(p);
    corrupt[corrupt.length - 1] ^= 0xff;
    await fs.writeFile(p, corrupt);
    expect(await readNativeWaveformCache(root, src)).toBeNull();
    expect(() => decodeNativeWaveformCache(src, corrupt)).toThrow();
    const other = { ...src, size: src.size + 1 };
    expect(() => decodeNativeWaveformCache(other, encodeNativeWaveformCache(src, fixture()))).toThrow();
    expect(await readNativeWaveformCache(root, other)).toBeNull();
  });

  it("invalidates a source when the same local file changes content or metadata", async () => {
    const root = path.join(dir, "cache-changed");
    const src = await identifyNativeWaveformSource(await fs.realpath(sourceFile));
    await writeNativeWaveformCache(root, src, fixture());
    await fs.appendFile(sourceFile, Buffer.from([12]));
    const changed = await identifyNativeWaveformSource(await fs.realpath(sourceFile));
    expect(nativeWaveformFingerprint(src).equals(nativeWaveformFingerprint(changed))).toBe(false);
    expect(await readNativeWaveformCache(root, changed)).toBeNull();
    await fs.writeFile(sourceFile, Buffer.alloc(128, 11));
  });

  it("rejects malformed level geometry and rejects a cache file with invalid descriptor", async () => {
    const src = await identifyNativeWaveformSource(await fs.realpath(sourceFile));
    const malformed = fixture();
    malformed.levels[0].minMax = Float32Array.from([0.4]);
    expect(() => encodeNativeWaveformCache(src, malformed)).toThrow();
    const bytes = encodeNativeWaveformCache(src, fixture());
    bytes.writeUInt32LE(60, 88);
    expect(() => decodeNativeWaveformCache(src, bytes)).toThrow();
    // Even a plausible duration change must invalidate the header checksum.
    const forgedMetadata = encodeNativeWaveformCache(src, fixture());
    forgedMetadata.writeDoubleLE(0.06, 16);
    expect(() => decodeNativeWaveformCache(src, forgedMetadata)).toThrow();
  });

  it("evicts every excess entry even when readdir order is not chronological", () => {
    // 2,050 entries exceed the production max of 2,000. Entry 0 is newest;
    // the old slice(0, MAX_CACHE_FILES) algorithm missed excess entries.
    const entries = Array.from({ length: 2050 }, (_, i) => ({
      name: i.toString().padStart(4, "0") + ".peak",
      bytes: 128,
      touchedMs: 2050 - i,
    })).reverse();
    const evictions = planNativeWaveformEvictions(entries);
    expect(evictions).toHaveLength(50);
    expect(evictions).toContain("2049.peak");
    expect(evictions).not.toContain("0000.peak");
  });

  it("honors byte quota, file quota and invalid cache-file sizes", () => {
    const files = [
      { name: "newest.peak", bytes: 128, touchedMs: 4 },
      { name: "second.peak", bytes: 128, touchedMs: 3 },
      { name: "oversized.peak", bytes: 9 * 1024 * 1024, touchedMs: 100 },
      { name: "older.peak", bytes: 128, touchedMs: 1 },
      { name: "invalid.peak", bytes: 0, touchedMs: 5 },
    ];
    expect(planNativeWaveformEvictions(files, 256, 4).sort()).toEqual([
      "invalid.peak", "older.peak", "oversized.peak",
    ]);
    expect(planNativeWaveformEvictions(files, 1024, 1).sort()).toEqual([
      "invalid.peak", "older.peak", "oversized.peak", "second.peak",
    ]);
  });

  it("cleans up an interrupted exclusive temporary write after one day", async () => {
    const root = path.join(dir, "cache-stale-temps");
    const src = await identifyNativeWaveformSource(await fs.realpath(sourceFile));
    await writeNativeWaveformCache(root, src, fixture());
    const name = "." + nativeWaveformFingerprint(src).toString("hex") +
      ".peak." + "a".repeat(16) + ".tmp";
    const stale = path.join(root, name);
    await fs.writeFile(stale, Buffer.from("abandoned"));
    const freshName = "." + nativeWaveformFingerprint(src).toString("hex") +
      ".peak." + "b".repeat(16) + ".tmp";
    await fs.writeFile(path.join(root, freshName), Buffer.from("active-write"));
    await fs.writeFile(path.join(root, "unrelated.txt"), Buffer.from("do-not-touch"));
    const expired = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await fs.utimes(stale, expired, expired);
    await writeNativeWaveformCache(root, src, fixture());
    const entries = await fs.readdir(root);
    expect(entries.includes(name)).toBe(false);
    expect(entries.includes(freshName)).toBe(true);
    expect(entries.includes("unrelated.txt")).toBe(true);
    expect((await readNativeWaveformCache(root, src))?.levels.length).toBe(3);
  });

  it("fails cleanly when the cache location is unusable", async () => {
    const root = path.join(dir, "cache-is-file");
    await fs.writeFile(root, Buffer.from("not-a-directory"));
    const src = await identifyNativeWaveformSource(await fs.realpath(sourceFile));
    await expect(writeNativeWaveformCache(root, src, fixture())).rejects.toThrow();
    expect(await readNativeWaveformCache(root, src)).toBeNull();
  });

  it("rejects symlinked cache entries instead of following them", async () => {
    if (process.platform === "win32") return; // no symlink privileges assumed in CI
    const root = path.join(dir, "cache-symlink");
    await fs.mkdir(root);
    const src = await identifyNativeWaveformSource(await fs.realpath(sourceFile));
    const destination = path.join(root, nativeWaveformFingerprint(src).toString("hex") + ".peak");
    await fs.symlink(sourceFile, destination);
    expect(await readNativeWaveformCache(root, src)).toBeNull();
  });
});
