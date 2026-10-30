/**
 * FFprobe integration — real metadata extraction via `shell: false` spawn.
 * Parses JSON output (-show_format -show_streams -print_format json).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { getFfprobePath } from "./paths";
import type { NativeAudioMeta } from "../../shared/ipc";
import { studioError } from "./errors";

/** Probe a file's audio metadata. Throws a typed error on failure. */
const MAX_PROBE_OUTPUT = 2 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 30_000;

export function probeFile(filePath: string, signal?: AbortSignal): Promise<NativeAudioMeta> {
  const ffprobe = getFfprobePath();
  if (!ffprobe) throw studioError("CAPABILITY_UNAVAILABLE", "FFprobe binary is not bundled.");

  let sizeBytes: number;
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new Error("Not a regular file.");
    sizeBytes = stats.size;
  } catch {
    throw studioError("MISSING_FILE", "The audio file is missing or inaccessible.");
  }
  if (signal?.aborted) {
    return Promise.reject(studioError("CANCELLED", "Audio metadata probe was cancelled."));
  }
  return new Promise<NativeAudioMeta>((resolve, reject) => {
    // User-supplied media is untrusted. Never allow a metadata process to hang
    // indefinitely or consume unlimited main-process RAM.
    const proc = spawn(ffprobe, [
      "-v", "error", "-show_format", "-show_streams", "-print_format", "json", filePath,
    ], { shell: false, windowsHide: true });
    let output = "";
    let settled = false;
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (code: "CANCELLED" | "DECODE_FAILED", message: string) => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch { /* exited already */ }
      finish();
      reject(studioError(code, message));
    };
    const abort = () => fail("CANCELLED", "Audio metadata probe was cancelled.");
    const timer = setTimeout(
      () => fail("DECODE_FAILED", "Audio metadata probe timed out after 30 seconds."),
      PROBE_TIMEOUT_MS
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > MAX_PROBE_OUTPUT) {
        fail("DECODE_FAILED", "Audio metadata response exceeded the safe size limit.");
      }
    });
    // Drain stderr so a corrupted file cannot block ffprobe's pipe.
    // Raw diagnostics can contain local filenames: do not expose them to UI.
    proc.stderr?.resume();
    proc.on("error", () => fail("DECODE_FAILED", "Unable to start audio metadata probe."));
    proc.on("close", (status) => {
      if (settled) return;
      if (status !== 0) {
        fail("DECODE_FAILED", "FFprobe could not read this media file.");
        return;
      }
      try {
        const json = JSON.parse(output);
        const stream = (json.streams ?? []).find((entry: { codec_type?: string }) => entry.codec_type === "audio");
        if (!stream) throw new Error("No audio stream.");
        const fmt = json.format ?? {};
        const duration = Number.parseFloat(stream.duration ?? fmt.duration ?? "0");
        const meta: NativeAudioMeta = {
          duration: Number.isFinite(duration) ? duration : 0,
          sampleRate: stream.sample_rate ? Number.parseInt(stream.sample_rate, 10) : null,
          channels: stream.channels ? Number.parseInt(stream.channels, 10) : null,
          codec: stream.codec_name ?? null,
          format: fmt.format_name ?? null,
          bitrateKbps: fmt.bit_rate ? Math.round(Number.parseInt(fmt.bit_rate, 10) / 1000) : null,
          sizeBytes,
        };
        settled = true;
        finish();
        resolve(meta);
      } catch {
        fail("DECODE_FAILED", "Audio metadata is invalid or incomplete.");
      }
    });
  });
}
