/**
 * Privileged native waveform peak generator.
 *
 * Source paths MUST come from main's completed/relinked stem registry.
 * FFmpeg is spawned without a shell and streams 8-kHz mono float32 PCM into
 * a bounded 40-Hz envelope collector. Never buffers the decoded recording.
 */
import { spawn } from "node:child_process";
import { getFfmpegPath } from "./paths";
import { studioError } from "./errors";
import { NativePeakCollector, type NativeWaveformResult } from "../../shared/native-waveform";

const MAX_WAVEFORM_MS = 5 * 60 * 1000;

export function generateNativeStemWaveform(
  approvedPath: string,
  approvedDuration: number,
  signal?: AbortSignal,
): Promise<NativeWaveformResult> {
  const binary = getFfmpegPath();
  if (!binary) throw studioError("CAPABILITY_UNAVAILABLE", "FFmpeg is not bundled.");
  if (signal?.aborted) {
    return Promise.reject(studioError("CANCELLED", "Waveform was cancelled."));
  }
  let collector: NativePeakCollector;
  try {
    collector = new NativePeakCollector(approvedDuration);
  } catch {
    throw studioError("INPUT_INVALID", "Waveform duration is invalid or exceeds the four-hour limit.");
  }

  return new Promise<NativeWaveformResult>((resolve, reject) => {
    const args = [
      "-hide_banner", "-nostdin", "-v", "error",
      "-i", approvedPath,
      "-map", "0:a:0", "-vn", "-sn", "-dn",
      "-ac", "1", "-ar", "8000",
      "-f", "f32le", "pipe:1",
    ];
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (reason: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { child.kill(); } catch { /* already stopped */ }
      reject(reason);
    };
    const abort = () => fail(studioError("CANCELLED", "Waveform generation was cancelled."));
    const timeout = setTimeout(() => fail(studioError(
      "DECODE_FAILED", "Waveform generation exceeded its safe processing time.",
    )), MAX_WAVEFORM_MS);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      try {
        collector.write(chunk);
      } catch {
        fail(studioError("DECODE_FAILED", "Decoded waveform exceeded its safe sample budget."));
      }
    });
    // Drain diagnostic output without retaining private source paths.
    child.stderr?.resume();
    child.on("error", () => fail(studioError("DECODE_FAILED", "Could not start the waveform decoder.")));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(studioError("DECODE_FAILED", "The local waveform decoder could not process this audio."));
        return;
      }
      try {
        const peaks = collector.finish();
        settled = true;
        cleanup();
        resolve(peaks);
      } catch {
        fail(studioError("DECODE_FAILED", "The waveform decoder produced incomplete audio."));
      }
    });
  });
}
