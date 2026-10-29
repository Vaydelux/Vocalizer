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
export function probeFile(filePath: string, signal?: AbortSignal): Promise<NativeAudioMeta> {
  const ffprobe = getFfprobePath();
  if (!ffprobe) {
    throw studioError("CAPABILITY_UNAVAILABLE", "FFprobe binary is not bundled. Bundle it via electron-builder extraResources.");
  }
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(filePath).size;
  } catch {
    throw studioError("MISSING_FILE", `Cannot stat ${filePath}`);
  }

  return new Promise<NativeAudioMeta>((resolve, reject) => {
    const argv = [
      "-v", "error",
      "-show_format",
      "-show_streams",
      "-print_format", "json",
      filePath,
    ];
    const proc = spawn(ffprobe, argv, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(studioError("UNKNOWN", `FFprobe spawn failed: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(studioError("DECODE_FAILED", `FFprobe exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      try {
        const json = JSON.parse(stdout);
        const stream = (json.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === "audio");
        const fmt = json.format ?? {};
        const duration = parseFloat(stream?.duration ?? fmt.duration ?? "0");
        resolve({
          duration: Number.isFinite(duration) ? duration : 0,
          sampleRate: stream?.sample_rate ? parseInt(stream.sample_rate, 10) : null,
          channels: stream?.channels ? parseInt(stream.channels, 10) : null,
          codec: stream?.codec_name ?? null,
          format: fmt.format_name ?? null,
          bitrateKbps: fmt.bit_rate ? Math.round(parseInt(fmt.bit_rate, 10) / 1000) : null,
          sizeBytes,
        });
      } catch (err) {
        reject(studioError("DECODE_FAILED", `FFprobe output parse failed: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
    if (signal) {
      signal.addEventListener("abort", () => {
        try { proc.kill("SIGKILL"); } catch { /* already exited */ }
      }, { once: true });
    }
  });
}
