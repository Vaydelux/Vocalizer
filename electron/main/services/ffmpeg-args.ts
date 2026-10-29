/**
 * FFmpeg argument builders — pure functions that turn a validated, typed
 * `FfmpegOp` into an argument array. No user string is ever interpolated into a
 * shell command; the main process spawns FFmpeg with `shell: false` and this
 * exact argv. Paths are passed as individual argv elements, so shell
 * metacharacters have no effect.
 */

import type { FfmpegFormat, FfmpegOp } from "../../shared/ipc";

/** Encoder + extra args for an output format. */
export function encoderArgs(format: FfmpegFormat, mp3Bitrate = 192): { codec: string; extra: string[] } {
  switch (format) {
    case "wav":
      return { codec: "pcm_s16le", extra: [] };
    case "wav24":
      return { codec: "pcm_s24le", extra: [] };
    case "mp3":
      return { codec: "libmp3lame", extra: ["-b:a", `${mp3Bitrate}k`] };
    case "flac":
      return { codec: "flac", extra: ["-compression_level", "8"] };
  }
}

/** A built command: argv[0] is the binary path (filled by the runner). */
export interface BuiltCommand {
  argv: string[];
  /** True when the operation requires the Rubber Band filter. */
  requiresRubberBand: boolean;
}

/** Build the FFmpeg argv for a trim operation (frame-accurate, re-encode). */
function buildTrim(op: Extract<FfmpegOp, { kind: "trim" }>): BuiltCommand {
  const enc = encoderArgs(op.outputFormat);
  const duration = Math.max(0, op.endSec - op.startSec);
  return {
    argv: [
      "-y",
      "-ss", op.startSec.toFixed(6),
      "-i", op.inputPath,
      "-t", duration.toFixed(6),
      "-vn",
      "-acodec", enc.codec,
      ...enc.extra,
      op.outputPath,
    ],
    requiresRubberBand: false,
  };
}

/** Build the FFmpeg argv for a join. Concat filter for N inputs (re-encode). */
function buildJoin(op: Extract<FfmpegOp, { kind: "join" }>): BuiltCommand {
  const enc = encoderArgs(op.outputFormat);
  const inputs: string[] = [];
  for (const p of op.inputPaths) inputs.push("-i", p);
  const n = op.inputPaths.length;
  // concat filter (audio only): [0][1]...[n-1]concat=n=N:v=0:a=1[out]
  const labels = op.inputPaths.map((_, i) => `[${i}]`).join("");
  const filter = `${labels}concat=n=${n}:v=0:a=1[out]`;
  return {
    argv: [
      "-y",
      ...inputs,
      "-filter_complex", filter,
      "-map", "[out]",
      "-acodec", enc.codec,
      ...enc.extra,
      op.outputPath,
    ],
    requiresRubberBand: false,
  };
}

/**
 * Build the FFmpeg argv for pitch/tempo.
 * - preserveDuration=true: rubberband pitch (keeps duration). Requires the
 *   Rubber Band filter; the runner rejects if it is unavailable.
 * - preserveDuration=false: asetrate (resample, pitch+tempo coupled) then
 *   atempo correction for the tempo ratio. No special filter needed.
 */
function buildPitch(op: Extract<FfmpegOp, { kind: "pitch" }>): BuiltCommand {
  const enc = encoderArgs(op.outputFormat);
  const semis = op.semitones + op.cents / 100;
  const pitchCents = semis * 100; // rubberband pitch is in cents
  const pitchRatio = Math.pow(2, semis / 12);

  if (op.preserveDuration) {
    // rubberband=pitch=PITCHCENTS keeps duration; tempo handled separately if !=1.
    const filters = [`rubberband=pitch=${pitchCents.toFixed(3)}`];
    if (Math.abs(op.tempo - 1) > 1e-3) {
      filters.push(`rubberband=tempo=${op.tempo.toFixed(4)}`);
    }
    return {
      argv: ["-y", "-i", op.inputPath, "-vn", "-af", filters.join(","), "-acodec", enc.codec, ...enc.extra, op.outputPath],
      requiresRubberBand: true,
    };
  }

  // Coupled: asetrate resamples (pitch × ratio, duration ÷ ratio), then atempo
  // adjusts duration by the tempo factor. Net: pitch × pitchRatio, tempo × tempo.
  // asetrate needs the source sample rate; use aresample to normalize after.
  const atempo = op.tempo / pitchRatio;
  const filters = [`asetrate=44100*${pitchRatio.toFixed(6)}`, `atempo=${atempo.toFixed(6)}`, "aresample=async=1"];
  return {
    argv: ["-y", "-i", op.inputPath, "-vn", "-af", filters.join(","), "-acodec", enc.codec, ...enc.extra, op.outputPath],
    requiresRubberBand: false,
  };
}

/** Convert/re-encode a file (optionally resampling). */
function buildConvert(op: Extract<FfmpegOp, { kind: "convert" }>): BuiltCommand {
  const enc = encoderArgs(op.outputFormat);
  const extra: string[] = [];
  if (op.sampleRate) extra.push("-ar", String(op.sampleRate));
  return {
    argv: ["-y", "-i", op.inputPath, "-vn", "-acodec", enc.codec, ...enc.extra, ...extra, op.outputPath],
    requiresRubberBand: false,
  };
}

/** Mix a vocal take onto an instrumental (amix, with delays + gains). */
function buildMix(op: Extract<FfmpegOp, { kind: "mix" }>): BuiltCommand {
  const enc = encoderArgs(op.outputFormat);
  const ms = Math.round(op.vocalStartSec * 1000);
  // [0] volume + delay (instrumental); [1] volume (vocal); amix
  const filter = [
    `[0]volume=${dbToGain(op.instrumentalGainDb).toFixed(6)},adelay=${ms}|${ms}[i]`,
    `[1]volume=${dbToGain(op.vocalGainDb).toFixed(6)}[v]`,
    `[i][v]amix=inputs=2:duration=longest:normalize=0[out]`,
  ].join(";");
  return {
    argv: ["-y", "-i", op.instrumentalPath, "-i", op.vocalPath, "-filter_complex", filter, "-map", "[out]", "-acodec", enc.codec, ...enc.extra, op.outputPath],
    requiresRubberBand: false,
  };
}

/** Dispatch an operation to its argv builder. */
export function buildFfmpegCommand(op: FfmpegOp): BuiltCommand {
  switch (op.kind) {
    case "trim":
      return buildTrim(op);
    case "join":
      return buildJoin(op);
    case "pitch":
      return buildPitch(op);
    case "convert":
      return buildConvert(op);
    case "mix":
      return buildMix(op);
  }
}

/** Convert decibels to a linear amplitude gain. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
