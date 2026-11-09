import type { JobResultFile } from "./types";

/** Reject fractional, NaN or infinite byte counts as well as empty output. */
export function hasValidJobOutput(result: JobResultFile | null | undefined): result is JobResultFile {
  return result !== null && result !== undefined &&
    Number.isSafeInteger(result.size) && result.size > 0;
}

/**
 * Releases the renderer-owned blob URL if a job result is discarded or evicted.
 * Native results may reference files belonging to the user or completed stem
 * registry; they must never be deleted as a side effect of renderer cleanup.
 */
export function releaseBrowserJobOutput(
  result: JobResultFile | null | undefined,
  revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
): boolean {
  if (!result || result.nativePath || typeof result.url !== "string" ||
      !result.url.startsWith("blob:")) {
    return false;
  }
  try {
    revoke(result.url);
    return true;
  } catch {
    // Object URL cleanup is best effort and must not turn a completed job
    // state transition into a processing failure.
    return false;
  }
}
