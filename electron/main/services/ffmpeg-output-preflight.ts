/**
 * Pure output-container validation shared by the native FFmpeg runner's
 * preflight and its regression tests. A renderer-provided extension or
 * outputFormat is never proof that source media supports a lossless copy.
 */
import * as path from "node:path";
import type { FfmpegOp } from "../../shared/ipc";
import {
  resolveStreamCopyContainer,
  type StreamCopyProbe,
} from "../../shared/stream-copy";

export function expectedOutputExtension(
  op: FfmpegOp,
  source?: StreamCopyProbe,
): string {
  if (op.kind === "trim" && op.lossless) {
    const copy = source ? resolveStreamCopyContainer(source) : null;
    if (!copy) {
      throw new Error(
        "Lossless stream-copy is unsupported for this source codec/container. Disable stream-copy to re-encode.",
      );
    }
    if (op.loudnessNormalize) {
      throw new Error("Lossless stream-copy cannot apply loudness normalization.");
    }
    return copy.extension;
  }
  if (op.outputFormat === "mp3") return "mp3";
  if (op.outputFormat === "flac") return "flac";
  return "wav";
}

export function assertOutputExtension(
  op: FfmpegOp,
  source?: StreamCopyProbe,
): void {
  const expected = expectedOutputExtension(op, source);
  const actual = path.extname(op.outputPath).toLowerCase();
  if (actual !== `.${expected}`) {
    throw new Error(
      `Output extension must be .${expected} for this audio operation; got ${actual || "(none)"}.`,
    );
  }
}
