"use client";

/**
 * Native (FFmpeg-backed) job tasks. Used only when the app runs inside Electron
 * (`window.studio` present). Each maps an existing task input to a typed
 * `FfmpegOp`, resolves a real save path via a native dialog, runs FFmpeg
 * through the validated IPC bridge, and returns a `JobResultFile` referencing
 * the verified file on disk.
 *
 * The web-preview tasks (`tasks.ts`) remain the fallback when `window.studio`
 * is absent — the same UI works in both runtimes via the dispatcher in
 * `tasks.ts`.
 */

import type { JobCtx, JobResultFile, ExportFormat, Mp3Bitrate } from "./types";
import type { AudioTrack } from "./types";
import type { FfmpegFormat, FfmpegOp } from "./ipc-contracts";
import { native, isNative } from "./native";
import { baseName, sanitizeFileName, timestampSlug } from "./format";
import { studioError } from "./errors";

/** Resolve the real disk path of a renderer File selection via the Electron
 *  webUtils API exposed on window.studio (the deprecated File.path is avoided). */
function filePath(file: File): string {
  const api = native();
  if (!api) throw studioError("CAPABILITY_UNAVAILABLE", "Native API unavailable (web preview).");
  const p = api.getPathForFile(file);
  if (!p) {
    throw studioError(
      "CAPABILITY_UNAVAILABLE",
      "No filesystem path for this File. Re-import it through the native file dialog when running in Electron."
    );
  }
  return p;
}

function mapFormat(format: ExportFormat): FfmpegFormat {
  if (format === "wav16") return "wav";
  if (format === "wav24") return "wav24";
  return "mp3";
}

function extFor(format: ExportFormat): string {
  return format === "mp3" ? "mp3" : "wav";
}

function bitrate(override?: { mp3Bitrate?: Mp3Bitrate }): number {
  return override?.mp3Bitrate ?? 192;
}

/** Ask the user for a real save path; throws CANCELLED if they back out. */
async function chooseOutputPath(defaultName: string, format: ExportFormat): Promise<string> {
  const api = native();
  if (!api) throw studioError("CAPABILITY_UNAVAILABLE", "Native API unavailable (web preview).");
  const ext = extFor(format);
  const chosen = await api.saveFile({
    defaultName: `${sanitizeFileName(baseName(defaultName))}_${timestampSlug()}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!chosen) throw studioError("CANCELLED", "Save dialog cancelled — no output written.");
  return chosen;
}

/** Run an FFmpeg op through the IPC bridge and wrap the verified result. */
async function runAndWrap(op: FfmpegOp, ctx: JobCtx, outputPath: string): Promise<JobResultFile> {
  const api = native();
  if (!api) throw studioError("CAPABILITY_UNAVAILABLE", "Native API unavailable.");
  const unsub = api.onFfmpegProgress((p) => {
    if (p.jobId === op.jobId) ctx.reportProgress(p.progress, p.stage);
  });
  const onAbort = () => {
    // AbortController alone does not terminate an Electron child process.
    void api.cancelFfmpeg({ jobId: op.jobId }).catch(() => {
      // If the process exited first, the pending run will settle normally.
    });
  };
  if (ctx.signal.aborted) {
    unsub();
    throw studioError("CANCELLED", "Cancelled before launching FFmpeg.");
  }
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await api.runFfmpeg(op);
    if (ctx.signal.aborted) {
      throw studioError("CANCELLED", "Cancelled while processing audio.");
    }
    ctx.log(`Output verified: ${result.outputPath} (${result.sizeBytes} B, ${result.durationSec.toFixed(2)}s).`);
    return {
      name: result.outputPath.split(/[\\/]/).pop() ?? "output",
      size: result.sizeBytes,
      url: result.outputPath, // absolute disk path; never pass to an HTML download anchor
      nativePath: true,
      mime: op.outputFormat === "mp3" ? "audio/mpeg" : op.outputFormat === "flac" ? "audio/flac" : "audio/wav",
    };
  } finally {
    ctx.signal.removeEventListener("abort", onAbort);
    unsub();
  }
}

interface FormatOverride {
  format?: ExportFormat;
  mp3Bitrate?: Mp3Bitrate;
}

/* ----------------------------------- tasks --------------------------------- */

export async function nativeTrimTask(
  input: { track: AudioTrack; startSec: number; endSec: number; override?: FormatOverride },
  ctx: JobCtx
): Promise<JobResultFile> {
  const fmt = input.override?.format ?? "wav16";
  const outputPath = await chooseOutputPath(input.track.name, fmt);
  ctx.log(`FFmpeg trim ${input.track.name} → ${outputPath}`);
  const op: FfmpegOp = {
    jobId: ctx.jobId,
    kind: "trim",
    inputPath: filePath(input.track.file),
    startSec: input.startSec,
    endSec: input.endSec,
    outputFormat: mapFormat(fmt),
    outputPath,
  };
  return await runAndWrap(op, ctx, outputPath);
}

export async function nativeJoinTask(
  input: { tracks: AudioTrack[]; crossfadeSec: number; override?: FormatOverride },
  ctx: JobCtx
): Promise<JobResultFile> {
  const fmt = input.override?.format ?? "wav16";
  const outputPath = await chooseOutputPath(input.tracks.map((t) => baseName(t.name)).join("+"), fmt);
  ctx.log(`FFmpeg join ${input.tracks.length} tracks → ${outputPath}`);
  const op: FfmpegOp = {
    jobId: ctx.jobId,
    kind: "join",
    inputPaths: input.tracks.map((t) => filePath(t.file)),
    crossfadeSec: input.crossfadeSec,
    outputFormat: mapFormat(fmt),
    outputPath,
  };
  return await runAndWrap(op, ctx, outputPath);
}

export async function nativePitchTask(
  input: { track: AudioTrack; semitones: number; cents: number; tempo: number; preserveDuration: boolean; override?: FormatOverride },
  ctx: JobCtx
): Promise<JobResultFile> {
  const fmt = input.override?.format ?? "wav16";
  const outputPath = await chooseOutputPath(input.track.name, fmt);
  ctx.log(`FFmpeg pitch ${input.semitones}st/${input.cents}c ×${input.tempo} → ${outputPath}`);
  const op: FfmpegOp = {
    jobId: ctx.jobId,
    kind: "pitch",
    inputPath: filePath(input.track.file),
    semitones: input.semitones,
    cents: input.cents,
    tempo: input.tempo,
    preserveDuration: input.preserveDuration,
    outputFormat: mapFormat(fmt),
    outputPath,
  };
  return await runAndWrap(op, ctx, outputPath);
}

export async function nativeConvertTask(
  input: { file: File; friendlyName: string; override?: FormatOverride },
  ctx: JobCtx
): Promise<JobResultFile> {
  const fmt = input.override?.format ?? "wav16";
  const outputPath = await chooseOutputPath(input.friendlyName, fmt);
  ctx.log(`FFmpeg convert ${input.friendlyName} → ${outputPath}`);
  const op: FfmpegOp = {
    jobId: ctx.jobId,
    kind: "convert",
    inputPath: filePath(input.file),
    sampleRate: null,
    outputFormat: mapFormat(fmt),
    outputPath,
  };
  return await runAndWrap(op, ctx, outputPath);
}

export async function nativeMixTask(
  input: { instrumental: AudioTrack; micFile: File; micStartSec: number; override?: FormatOverride },
  ctx: JobCtx
): Promise<JobResultFile> {
  const fmt = input.override?.format ?? "wav16";
  const outputPath = await chooseOutputPath(input.instrumental.name + "-mix", fmt);
  ctx.log(`FFmpeg mix → ${outputPath}`);
  const op: FfmpegOp = {
    jobId: ctx.jobId,
    kind: "mix",
    instrumentalPath: filePath(input.instrumental.file),
    vocalPath: filePath(input.micFile),
    vocalStartSec: input.micStartSec,
    outputFormat: mapFormat(fmt),
    outputPath,
  };
  return await runAndWrap(op, ctx, outputPath);
}

export { isNative };
