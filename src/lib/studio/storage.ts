/**
 * Model storage service — directory contract and safe path handling.
 *
 * In the web preview runtime there is no filesystem access, so this module
 * exposes the typed contract and validation logic that the desktop (Electron)
 * build backs with real directory operations under `app.getPath("userData")`.
 * All functions are side-effect free and safe to call in either runtime.
 */

import type { ModelFile } from "./types";

/** Platform-appropriate directory layout under the application data directory. */
export const MODEL_DIR_CONTRACT = {
  installed: "models/installed",
  staging: "models/staging",
  metadata: "models/metadata",
  cache: "cache",
  jobs: "jobs",
  logs: "logs",
  settings: "settings",
  /** Future bundled default model location (packaged resources, read-only). */
  bundledDefault: "resources/models/default",
} as const;

/** True when the relative path is safe to use inside the model storage root. */
export function isSafeRelativePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 255) return false;
  if (/[\x00-\x1f]/.test(p)) return false;
  if (/[\\/:*?"<>|]/.test(p)) return false; // shell/path metacharacters
  if (p.startsWith("/") || p.startsWith("\\")) return false; // absolute
  if (/^[A-Za-z]:/.test(p)) return false; // Windows drive letters
  const segments = p.split(/[\\/]/);
  if (segments.includes("..")) return false; // traversal
  if (segments.includes(".")) return false; // avoid lone "." segments
  return true;
}

/** Reject symlink-escape patterns — the desktop build resolves real paths and
 *  compares them against the storage root; this helper only catches textual
 *  indicators. */
export function looksLikeSymlinkEscape(p: string): boolean {
  // The desktop build must additionally call fs.realpath and verify the result
  // is still inside the storage root. This is a textual pre-check only.
  return p.includes("..") || p.startsWith("/") || /^[A-Za-z]:/.test(p);
}

/** Validate every file path in a manifest's file list. Returns issues (empty = ok). */
export function validateModelFilePaths(files: ModelFile[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!isSafeRelativePath(f.path)) {
      issues.push(`Unsafe file path rejected: "${f.path}". Only relative paths inside the model storage directory are allowed.`);
      continue;
    }
    if (seen.has(f.path)) {
      issues.push(`Duplicate file path: "${f.path}".`);
    }
    seen.add(f.path);
  }
  return issues;
}

export interface StorageUsage {
  /** Total bytes of installed model files (computed from real files when present). */
  installedBytes: number;
  /** Cache bytes (desktop build reports; web preview reports 0). */
  cacheBytes: number;
  /** Number of registered model records. */
  registeredCount: number;
  /** Number of available inference adapters (typed stubs count as registered). */
  adapterCount: number;
  /** Missing or corrupted file warnings (desktop build fills; web preview empty). */
  warnings: string[];
  /** Honest label: the directory path is only known in the desktop build. */
  directory: string;
}

/** Web-preview storage report — honest about what isn't backed by real files. */
export function webPreviewStorageUsage(
  registeredCount: number,
  adapterCount: number,
  declaredBytes: number
): StorageUsage {
  return {
    installedBytes: declaredBytes,
    cacheBytes: 0,
    registeredCount,
    adapterCount,
    warnings: [
      "Web preview runtime: no model files are present on disk. Real disk usage accounting and directory paths are populated by the Electron desktop build.",
    ],
    directory: "N/A in web preview — populated by app.getPath('userData') in the desktop build",
  };
}
