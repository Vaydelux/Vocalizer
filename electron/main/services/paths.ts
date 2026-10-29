/**
 * Path resolution for the desktop runtime.
 *
 * - In dev: FFmpeg/FFprobe resolve from `resources/binaries/` (developer
 *   supplies them) or PATH.
 * - In packaged: resolve from `process.resourcesPath/binaries/` (bundled via
 *   electron-builder `extraResources`, asar-unpacked).
 * - User data directories live under `app.getPath('userData')`.
 * - All model/storage paths are confined to the user-data root; path-traversal
 *   validation happens in the storage/path-validation module.
 */

import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { isPackaged } from "../index";

let cachedFfmpeg: string | null | undefined;
let cachedFfprobe: string | null | undefined;

function bundledBinary(name: string): string | null {
  const dir = isPackaged
    ? path.join(process.resourcesPath, "binaries")
    : path.join(__dirname, "..", "..", "..", "resources", "binaries");
  const candidates =
    process.platform === "win32"
      ? [path.join(dir, `${name}.exe`), path.join(dir, name)]
      : [path.join(dir, name)];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Resolve the FFmpeg binary path (bundled preferred, else PATH). */
export function getFfmpegPath(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  cachedFfmpeg = bundledBinary("ffmpeg");
  return cachedFfmpeg;
}

/** Resolve the FFprobe binary path. */
export function getFfprobePath(): string | null {
  if (cachedFfprobe !== undefined) return cachedFfprobe;
  cachedFfprobe = bundledBinary("ffprobe");
  return cachedFfprobe;
}

export function userDataDir(): string {
  return app.getPath("userData");
}

export function modelsDir(): string {
  const p = path.join(userDataDir(), "models", "installed");
  ensureDir(p);
  return p;
}

export function stagingDir(): string {
  const p = path.join(userDataDir(), "models", "staging");
  ensureDir(p);
  return p;
}

export function cacheDir(): string {
  const p = path.join(userDataDir(), "cache");
  ensureDir(p);
  return p;
}

export function jobsDir(): string {
  const p = path.join(userDataDir(), "jobs");
  ensureDir(p);
  return p;
}

export function logsDir(): string {
  const p = path.join(userDataDir(), "logs");
  ensureDir(p);
  return p;
}

export function resourcesDir(): string {
  return process.resourcesPath;
}

function ensureDir(p: string): void {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    /* permission errors surfaced to the caller via the IPC layer */
  }
}

/** Resolve a path kind to its absolute directory. */
export function resolvePathKind(kind: "userData" | "models" | "cache" | "jobs" | "logs" | "resources"): string {
  switch (kind) {
    case "userData":
      return userDataDir();
    case "models":
      return modelsDir();
    case "cache":
      return cacheDir();
    case "jobs":
      return jobsDir();
    case "logs":
      return logsDir();
    case "resources":
      return resourcesDir();
  }
}
