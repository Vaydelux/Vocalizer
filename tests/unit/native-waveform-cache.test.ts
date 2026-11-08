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
