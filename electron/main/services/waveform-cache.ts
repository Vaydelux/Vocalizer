/**
 * Integrity-checked on-disk waveform envelope cache.
 *
 * Only privileged main-owned verified stem paths may be passed in.
 * No raw media, filesystem path or project JSON is persisted in cache files.
 * Cached waveforms are a performance hint, never an authorization source.
 */
import { createHash, randomBytes } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import * as path from "node:path";
import type { NativeWaveformResult } from "../../shared/native-waveform";

const MAGIC = Buffer.from("VLWFPK01"); // 8-byte file signature
const HEADER_BYTES = 128;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_DISK_BYTES = 128 * 1024 * 1024;
const MAX_CACHE_FILES = 2000;
const CACHE_TEMP_TTL_MS = 24 * 60 * 60 * 1000;
const LEVEL_FPS = [40, 10, 2];
const CACHE_FILENAME = /^[0-9a-f]{64}\.peak$/;
const CACHE_TEMP_FILENAME = /^\.[0-9a-f]{64}\.peak\.[0-9a-f]{16}\.tmp$/;

export interface NativeCacheCandidate {
  name: string;
  bytes: number;
  touchedMs: number;
}

/**
 * Deterministically select least-recently-used entries for eviction. Examine
 * every owned cache entry; arbitrarily slicing directory results could leave
 * older data untouched and make the nominal disk quota unenforceable.
 */
export function planNativeWaveformEvictions(
  candidates: readonly NativeCacheCandidate[],
  maxBytes = MAX_DISK_BYTES,
  maxFiles = MAX_CACHE_FILES,
): string[] {
  const sorted = [...candidates].sort((a, b) =>
    b.touchedMs - a.touchedMs || a.name.localeCompare(b.name));
  let kept = 0;
  let used = 0;
  const evictions: string[] = [];
  for (const file of sorted) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < HEADER_BYTES ||
        file.bytes > MAX_ENTRY_BYTES || !Number.isFinite(file.touchedMs) ||
        kept >= maxFiles || used + file.bytes > maxBytes) {
      evictions.push(file.name);
      continue;
    }
    kept++;
    used += file.bytes;
  }
  return evictions;
}

export interface NativeWaveformSourceSignature {
  canonicalPath: string;
  device: number;
  inode: number;
  size: number;
  modifiedMs: number;
  changedMs: number;
}

export async function identifyNativeWaveformSource(
  canonicalPath: string,
): Promise<NativeWaveformSourceSignature> {
  const [resolved, info] = await Promise.all([
    fs.realpath(canonicalPath), fs.lstat(canonicalPath),
  ]);
  if (resolved !== canonicalPath || !info.isFile() || info.isSymbolicLink() ||
      !Number.isSafeInteger(info.size) || info.size <= 0) {
    throw new Error("Waveform cache requires a registered regular file.");
  }
  return {
    canonicalPath, device: info.dev, inode: info.ino, size: info.size,
    modifiedMs: info.mtimeMs, changedMs: info.ctimeMs,
  };
}

export function nativeWaveformFingerprint(source: NativeWaveformSourceSignature): Buffer {
  return createHash("sha256").update(JSON.stringify([
    "v1", source.canonicalPath, source.device, source.inode, source.size,
    source.modifiedMs, source.changedMs,
  ])).digest();
}

function entryPath(root: string, source: NativeWaveformSourceSignature): string {
  return path.join(root, nativeWaveformFingerprint(source).toString("hex") + ".peak");
}

function validateLevels(result: NativeWaveformResult): void {
  if (!Number.isFinite(result.duration) || result.duration <= 0 ||
      result.duration > 4 * 3600 || result.sampleRate !== 8000 ||
      result.levels.length !== LEVEL_FPS.length) {
    throw new Error("Waveform cache metadata is out of bounds.");
  }
  for (let i = 0; i < result.levels.length; i++) {
    const level = result.levels[i];
    if (level.fps !== LEVEL_FPS[i] ||
        !Number.isSafeInteger(level.buckets) || level.buckets < 1 ||
        level.buckets > Math.ceil((result.duration + 2) * level.fps) ||
        level.minMax.length !== level.buckets * 2 ||
        !level.minMax.every(Number.isFinite)) {
      throw new Error("Waveform cache contains invalid peak data.");
    }
  }
}

export function encodeNativeWaveformCache(
  source: NativeWaveformSourceSignature,
  waveform: NativeWaveformResult,
): Buffer {
  validateLevels(waveform);
  const parts = waveform.levels.map(level => {
    const part = Buffer.allocUnsafe(level.minMax.byteLength);
    for (let i = 0; i < level.minMax.length; i++) {
      part.writeFloatLE(level.minMax[i], i * 4);
    }
    return part;
  });
  const payload = Buffer.concat(parts);
  if (payload.length + HEADER_BYTES > MAX_ENTRY_BYTES) throw new Error("Waveform cache entry is too large.");
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt16LE(1, 8);
  header.writeUInt16LE(LEVEL_FPS.length, 10);
  header.writeUInt32LE(waveform.sampleRate, 12);
  header.writeDoubleLE(waveform.duration, 16);
  nativeWaveformFingerprint(source).copy(header, 24);
  for (let i = 0; i < waveform.levels.length; i++) {
    const offset = 88 + i * 12;
    header.writeUInt32LE(waveform.levels[i].fps, offset);
    header.writeUInt32LE(waveform.levels[i].buckets, offset + 4);
    header.writeUInt32LE(parts[i].length, offset + 8);
  }
  // Cover header descriptors AND payload, not only the Float32 samples.
  createHash("sha256")
    .update(header.subarray(0, 56))
    .update(header.subarray(88))
    .update(payload)
    .digest().copy(header, 56);
  return Buffer.concat([header, payload], HEADER_BYTES + payload.length);
}

export function decodeNativeWaveformCache(
  source: NativeWaveformSourceSignature, data: Buffer,
): NativeWaveformResult {
  if (data.length < HEADER_BYTES || data.length > MAX_ENTRY_BYTES ||
      !data.subarray(0, MAGIC.length).equals(MAGIC) ||
      data.readUInt16LE(8) !== 1 || data.readUInt16LE(10) !== LEVEL_FPS.length ||
      data.readUInt32LE(12) !== 8000 ||
      !data.subarray(24, 56).equals(nativeWaveformFingerprint(source))) {
    throw new Error("Waveform cache format or source identity mismatch.");
  }
  const expectedHash = data.subarray(56, 88);
  const payload = data.subarray(HEADER_BYTES);
  if (!createHash("sha256")
    .update(data.subarray(0, 56))
    .update(data.subarray(88, HEADER_BYTES))
    .update(payload).digest().equals(expectedHash)) {
    throw new Error("Waveform cache checksum mismatch.");
  }
  const duration = data.readDoubleLE(16);
  const levels: NativeWaveformResult["levels"] = [];
  let cursor = 0;
  for (let i = 0; i < LEVEL_FPS.length; i++) {
    const descriptor = 88 + i * 12;
    const fps = data.readUInt32LE(descriptor);
    const buckets = data.readUInt32LE(descriptor + 4);
    const byteCount = data.readUInt32LE(descriptor + 8);
    if (fps !== LEVEL_FPS[i] || byteCount > MAX_ENTRY_BYTES ||
        buckets * 8 !== byteCount || cursor + byteCount > payload.length) {
      throw new Error("Waveform cache level descriptor is invalid.");
    }
    const samples = new Float32Array(buckets * 2);
    for (let j = 0; j < samples.length; j++) {
      samples[j] = payload.readFloatLE(cursor + j * 4);
    }
    levels.push({ fps, buckets, minMax: samples });
    cursor += byteCount;
  }
  if (cursor !== payload.length) throw new Error("Waveform cache trailing bytes are invalid.");
  const result = { duration, sampleRate: 8000, levels };
  validateLevels(result);
  return result;
}

async function ensurePrivateCacheDirectory(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Waveform cache directory is not a safe directory.");
  }
}

export async function readNativeWaveformCache(
  root: string, source: NativeWaveformSourceSignature,
): Promise<NativeWaveformResult | null> {
  try {
    const p = entryPath(root, source);
    const named = await fs.lstat(p);
    if (!named.isFile() || named.isSymbolicLink() || named.size < HEADER_BYTES ||
        named.size > MAX_ENTRY_BYTES) return null;
    // No-follow on POSIX; Windows still verifies handle identity against lstat.
    const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
    const handle = await fs.open(p, constants.O_RDONLY | noFollow);
    let data: Buffer;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== named.dev ||
          opened.ino !== named.ino || opened.size !== named.size) return null;
      // Never use readFile() on a path that could grow after lstat:
      // read no more than the approved small cache size and reject trailing data.
      data = Buffer.allocUnsafe(named.size);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
        if (bytesRead === 0) return null;
        offset += bytesRead;
      }
      const extra = Buffer.alloc(1);
      const tail = await handle.read(extra, 0, 1, data.length);
      if (tail.bytesRead !== 0) return null;
    } finally {
      await handle.close();
    }
    const parsed = decodeNativeWaveformCache(source, data);
    // Best-effort approximate LRU touch. A denied utimes does not lose peaks.
    void fs.utimes(p, new Date(), new Date()).catch(() => {});
    return parsed;
  } catch {
    // Missing, corrupt or replaced cache files are treated as safe misses.
    return null;
  }
}

/**
 * Quota and interrupted-write recovery. Scan ALL app-owned peak entries, but
 * limit concurrent filesystem operations so a large cache cannot flood the
 * event loop with thousands of simultaneous lstat calls.
 */
async function pruneNativeWaveformCache(root: string): Promise<void> {
  const dirents = await fs.readdir(root, { withFileTypes: true });
  const files: NativeCacheCandidate[] = [];
  const staleTemp: string[] = [];
  const cutoff = Date.now() - CACHE_TEMP_TTL_MS;
  const owned = dirents.filter(item => item.isFile() &&
    (CACHE_FILENAME.test(item.name) || CACHE_TEMP_FILENAME.test(item.name)));

  for (let offset = 0; offset < owned.length; offset += 32) {
    const batch = owned.slice(offset, offset + 32);
    await Promise.all(batch.map(async item => {
      const pathname = path.join(root, item.name);
      try {
        const info = await fs.lstat(pathname);
        if (!info.isFile() || info.isSymbolicLink()) return;
        if (CACHE_FILENAME.test(item.name)) {
          files.push({ name: item.name, bytes: info.size, touchedMs: info.mtimeMs });
        } else if (info.mtimeMs < cutoff) {
          staleTemp.push(pathname);
        }
      } catch { /* Concurrent edits and read-only caches are non-fatal. */ }
    }));
  }

  for (const filename of planNativeWaveformEvictions(files)) {
    try { await fs.unlink(path.join(root, filename)); }
    catch { /* Best-effort cache eviction. */ }
  }
  for (const pathname of staleTemp) {
    try { await fs.unlink(pathname); }
    catch { /* Interrupted temporary files are non-critical. */ }
  }
}

export async function writeNativeWaveformCache(
  root: string, source: NativeWaveformSourceSignature, waveform: NativeWaveformResult,
): Promise<void> {
  const bytes = encodeNativeWaveformCache(source, waveform);
  await ensurePrivateCacheDirectory(root);
  const destination = entryPath(root, source);
  const temp = path.join(root, "." + path.basename(destination) + "." + randomBytes(8).toString("hex") + ".tmp");
  try {
    await fs.writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, destination);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
  await pruneNativeWaveformCache(root);
}
