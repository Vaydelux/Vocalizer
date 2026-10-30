/**
 * FFmpeg process runner — safe, cancellable, with real progress and output
 * verification.
 *
 * Security: spawns with `shell: false` using the argv produced by
 * `buildFfmpegCommand`. No user string is interpolated into a shell.
 *
 * Cancellation: each job's child process is tracked by jobId; `cancel(jobId)`
 * sends SIGKILL (and SIGTERM first on non-Windows) and removes the temp output.
 *
 * Progress: parses FFmpeg's `-progress pipe:1` machine-readable output to
 * produce a real 0..1 fraction. When duration is unknown it reports null
 * (indeterminate) — never a fabricated percentage.
 *
 * Verification: after FFmpeg exits 0, the output is re-probed with FFprobe to
 * confirm a non-zero duration and non-zero size before reporting success.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildFfmpegCommand } from "./ffmpeg-args";
import { getFfmpegPath } from "./paths";
import { createStagedOutput, publishStagedOutput, cleanupStagedOutput } from "./export-file";
import { probeFile } from "./ffprobe";
import { studioError, toMainErrorPayload, type MainErrorCode } from "./errors";
import type { FfmpegOp, FfmpegResult, FfmpegProgress } from "../../shared/ipc";

interface RunHandle {
  proc: ChildProcess;
  outputPath: string;
  aborted: boolean;
}

const activeJobs = new Map<string, RunHandle>();

/** Progress callback receives {progress, stage}. */
export type ProgressEmitter = (p: FfmpegProgress) => void;

export async function runFfmpeg(op: FfmpegOp, emit: ProgressEmitter): Promise<FfmpegResult> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    throw studioError("CAPABILITY_UNAVAILABLE", "FFmpeg binary is not bundled. Bundle it via electron-builder extraResources.");
  }
  if (activeJobs.has(op.jobId)) {
    throw studioError("INPUT_INVALID", "A native audio operation already uses this job ID.");
  }
  let stagedPath: string;
  try {
    // Never feed FFmpeg the destination path. A failed -y output previously
    // truncated or deleted user files, including pre-existing ones.
    stagedPath = createStagedOutput(op.outputPath);
  } catch (error) {
    throw studioError("PERMISSION_DENIED", error instanceof Error ? error.message : "Cannot prepare an audio export.");
  }
  const built = buildFfmpegCommand({ ...op, outputPath: stagedPath });
  const argv = built.argv;

  return new Promise<FfmpegResult>((resolve, reject) => {
    const proc = spawn(ffmpeg, argv, { shell: false, windowsHide: true });
    const handle: RunHandle = { proc, outputPath: stagedPath, aborted: false };
    activeJobs.set(op.jobId, handle);

    let stderr = "";
    let totalDuration: number | null = null;

    // Probe the source duration once (best-effort) to convert FFmpeg's
    // out_time_ms into a 0..1 fraction. For multi-input ops (join/mix), this
    // remains null and progress is indeterminate.
    void maybeProbeSourceDuration(op).then((d) => {
      totalDuration = d;
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      // Avoid unbounded RAM use from large FFmpeg error logs.
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.startsWith("out_time_us=") && totalDuration) {
          const us = parseInt(line.slice("out_time_us=".length), 10);
          const frac = Math.min(1, Math.max(0, us / 1_000_000 / totalDuration));
          emit({ jobId: op.jobId, progress: frac, stage: "Processing" });
        }
      }
    });

    proc.on("error", (err) => {
      activeJobs.delete(op.jobId);
      cleanupStagedOutput(stagedPath);
      reject(studioError("ENCODE_FAILED", `FFmpeg spawn failed: ${err.message}`));
    });

    proc.on("close", (code) => {
      activeJobs.delete(op.jobId);
      if (handle.aborted) {
        cleanupStagedOutput(stagedPath);
        reject(studioError("CANCELLED"));
        return;
      }
      if (code !== 0) {
        cleanupStagedOutput(stagedPath);
        const detail = stderr.slice(-400);
        reject(studioError("ENCODE_FAILED", `FFmpeg exited ${code}. ${detail}`));
        return;
      }
      // Verify the output: exists, non-zero size, decodable.
      verifyOutput(stagedPath)
        .then((verified) => {
          if (!verified.verified) {
            cleanupStagedOutput(stagedPath);
            reject(studioError("OUTPUT_EMPTY", "The encoded output failed audio verification."));
            return;
          }
          try {
            publishStagedOutput(stagedPath, op.outputPath);
          } catch (error) {
            cleanupStagedOutput(stagedPath);
            reject(studioError("PERMISSION_DENIED",
              `Could not publish the verified audio file without overwriting another file: ${String(error)}`));
            return;
          }
          emit({ jobId: op.jobId, progress: 1, stage: "Completed" });
          resolve({
            outputPath: op.outputPath,
            sizeBytes: verified.sizeBytes,
            durationSec: verified.durationSec,
            verified: true,
          });
        })
        .catch((err) => {
          cleanupStagedOutput(stagedPath);
          reject(err);
        });
    });
  });
}

/** Cancel a running job: kill the process and mark aborted. */
export function cancelJob(jobId: string): boolean {
  const handle = activeJobs.get(jobId);
  if (!handle) return false;
  handle.aborted = true;
  try {
    if (process.platform === "win32") {
      // Windows: kill the whole tree via taskkill (FFmpeg may spawn children).
      spawn("taskkill", ["/PID", String(handle.proc.pid), "/T", "/F"], { shell: false, windowsHide: true });
    } else {
      handle.proc.kill("SIGTERM");
      setTimeout(() => {
        try { handle.proc.kill("SIGKILL"); } catch { /* already dead */ }
      }, 500);
    }
  } catch {
    /* already exited */
  }
  return true;
}

async function maybeProbeSourceDuration(op: FfmpegOp): Promise<number | null> {
  try {
    const inputPath =
      op.kind === "trim" || op.kind === "pitch" || op.kind === "convert"
        ? op.inputPath
        : op.kind === "mix"
          ? op.instrumentalPath
          : null; // join has multiple inputs; skip
    if (!inputPath) return null;
    const meta = await probeFile(inputPath);
    return meta.duration > 0 ? meta.duration : null;
  } catch {
    return null;
  }
}

async function verifyOutput(outputPath: string): Promise<{ verified: boolean; sizeBytes: number; durationSec: number }> {
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(outputPath).size;
  } catch {
    return { verified: false, sizeBytes: 0, durationSec: 0 };
  }
  if (sizeBytes === 0) return { verified: false, sizeBytes: 0, durationSec: 0 };
  try {
    const meta = await probeFile(outputPath);
    return { verified: meta.duration > 0, sizeBytes, durationSec: meta.duration };
  } catch {
    return { verified: false, sizeBytes, durationSec: 0 };
  }
}

/** Re-export the payload serializer for IPC handlers. */
export { toMainErrorPayload, type MainErrorCode };
