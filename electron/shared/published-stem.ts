/**
 * Published AI stems use a stable, model-independent filename convention.
 * This parser recognizes only filenames that Vocalizer itself publishes;
 * a project JSON path or arbitrary user filename can never authorize I/O.
 */
import type { NativeStemRef, NativeStemName } from "./stem-input";

const STEM_NAMES: readonly NativeStemName[] = [
  "Vocals", "Instrumental", "Drums", "Bass", "Guitar", "Piano", "Other",
];

/** No directory separators, path normalization, or renderer-controlled paths. */
export function parsePublishedStemFilename(filename: string): NativeStemRef | null {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("\0")) return null;
  const match = /^Vocalizer-([A-Za-z0-9_-]{1,80})-(vocals|instrumental|drums|bass|guitar|piano|other)\.(wav|flac|mp3)$/i.exec(filename);
  if (!match) return null;
  const stem = STEM_NAMES.find((item) => item.toLowerCase() === match[2].toLowerCase());
  return stem ? { jobId: match[1], stem } : null;
}

/** Matching cannot be inferred from name alone, nor from a guessed duration. */
export function doesRelinkedStemMatch(
  expected: { name: string; size: number; duration: number | null },
  actual: { name: string; size: number; duration: number },
): boolean {
  if (expected.name !== actual.name ||
      !Number.isSafeInteger(expected.size) || expected.size <= 0 ||
      expected.size !== actual.size ||
      !Number.isFinite(actual.duration) || actual.duration <= 0) return false;
  if (expected.duration !== null) {
    if (!Number.isFinite(expected.duration) || expected.duration <= 0) return false;
    if (Math.abs(expected.duration - actual.duration) > Math.max(0.25, expected.duration * 0.01)) return false;
  }
  return parsePublishedStemFilename(expected.name) !== null;
}
