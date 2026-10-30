/**
 * Stage native FFmpeg exports safely. Encoding must never delete or replace an
 * existing user file if a job fails, is cancelled, or exits unexpectedly.
 *
 * The staging file lives beside the destination (same filesystem) and keeps
 * its real extension so FFmpeg can identify the output muxer. Finalization
 * uses an exclusive hard link first, falling back to COPYFILE_EXCL on volumes
 * where hard links are unsupported (e.g. removable drives).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export function createStagedOutput(destination: string): string {
  if (!path.isAbsolute(destination)) throw new Error("Output must be an absolute path.");
  const directory = path.dirname(destination);
  const ext = path.extname(destination).toLowerCase();
  if (![".wav", ".flac", ".mp3"].includes(ext)) {
    throw new Error("Output must have a supported audio extension.");
  }
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(destination)) throw new Error("The destination already exists. Choose another file name.");
  return path.join(directory, `.vocalizer-partial-${randomUUID()}${ext}`);
}

export function publishStagedOutput(stagedPath: string, destination: string): void {
  if (path.dirname(stagedPath) !== path.dirname(destination)) {
    throw new Error("Staged file must be in the destination directory.");
  }
  if (!fs.statSync(stagedPath).isFile()) throw new Error("The encoded output is missing.");
  // link() fails with EEXIST instead of overwriting. If the target filesystem
  // does not support hard links, exclusive copyFile preserves the same guard.
  try {
    fs.linkSync(stagedPath, destination);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!["EPERM", "EOPNOTSUPP", "ENOTSUP", "EXDEV", "ENOSYS"].includes(code ?? "")) throw err;
    fs.copyFileSync(stagedPath, destination, fs.constants.COPYFILE_EXCL);
  }
  fs.unlinkSync(stagedPath);
}

export function cleanupStagedOutput(stagedPath: string): void {
  try {
    fs.unlinkSync(stagedPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // A failed cleanup should be visible in native diagnostics, but must
      // not mask the original encoding error.
      console.error("Could not clean up staged Vocalizer output:", err);
    }
  }
}
