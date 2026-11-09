/**
 * Genuine lossless Cutter integration checks with locally generated tones.
 * Uses FFmpeg stream-copy argv and FFprobe metadata. No licensed audio.
 *
 * Usage: bun scripts/smoke-lossless-cutter.ts <ffmpeg> <ffprobe>
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdtempSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFfmpegCommand } from "../electron/main/services/ffmpeg-args";
import { assertOutputExtension } from "../electron/main/services/ffmpeg-output-preflight";
import { createStagedOutput, publishStagedOutput, cleanupStagedOutput } from "../electron/main/services/export-file";
import { resolveStreamCopyContainer } from "../electron/shared/stream-copy";
import type { FfmpegOp } from "../electron/shared/ipc";

function run(exe: string, argv: string[]): string {
  const p = spawnSync(exe, argv, {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  if (p.error || p.status !== 0) {
    throw new Error(`${exe} exit ${p.status}: ${p.error?.message ?? p.stderr?.slice(-900)}`);
  }
  return p.stdout;
}

interface Metadata {
  streams?: Array<{ codec_type?: string; codec_name?: string }>;
  format?: { format_name?: string; duration?: string };
}

function probe(ffprobe: string, file: string): { codec: string; format: string; duration: number } {
  const value = JSON.parse(run(ffprobe, [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name:format=format_name,duration",
    "-of", "json", file,
  ])) as Metadata;
  const audio = value.streams?.find((stream) => stream.codec_type === "audio");
  if (!audio?.codec_name || !value.format?.format_name) throw new Error("Missing verified audio stream.");
  return {
    codec: audio.codec_name,
    format: value.format.format_name,
    duration: Number(value.format.duration),
  };
}

const ffmpeg = process.argv[2];
const ffprobe = process.argv[3];
if (!ffmpeg || !ffprobe) throw new Error("Usage: bun scripts/smoke-lossless-cutter.ts <ffmpeg> <ffprobe>");

const folder = mkdtempSync(join(tmpdir(), "vocalizer-lossless-cutter-"));
try {
  const original = join(folder, "fixture.wav");
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100:duration=2.5",
    "-ac", "2", "-c:a", "pcm_s16le", original,
  ]);

  const formats = [
    { name: "wav", codec: "pcm_s16le", expected: "wav" },
    { name: "mp3", codec: "libmp3lame", expected: "mp3" },
    { name: "m4a", codec: "aac", expected: "m4a" },
    { name: "ogg", codec: "libvorbis", expected: "ogg" },
  ];
  for (const item of formats) {
    const input = join(folder, `source.${item.name}`);
    run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
      "-i", original, "-vn", "-c:a", item.codec, input,
    ]);
    const beforeBytes = statSync(input).size;
    const meta = probe(ffprobe, input);
    const container = resolveStreamCopyContainer(meta);
    if (!container || container.extension !== item.expected) {
      throw new Error(`Unexpected verified source container for ${item.name}: ${JSON.stringify(meta)}`);
    }

    const target = join(folder, `cut-${item.name}.${container.extension}`);
    const request: FfmpegOp = {
      jobId: `lossless-${item.name}`,
      kind: "trim",
      inputPath: input,
      outputPath: target,
      outputFormat: "wav",
      startSec: 0.5,
      endSec: 1.75,
      lossless: true,
    };
    assertOutputExtension(request, meta);
    const staged = createStagedOutput(target);
    try {
      const command = buildFfmpegCommand({ ...request, outputPath: staged });
      run(ffmpeg, ["-hide_banner", "-loglevel", "error", ...command.argv]);
      const actual = probe(ffprobe, staged);
      if (actual.codec !== meta.codec || !(actual.duration > 0.7 && actual.duration < 1.9)) {
        throw new Error(`Lossless output codec/duration mismatch for ${item.name}: ${JSON.stringify(actual)}`);
      }
      publishStagedOutput(staged, target);
    } finally {
      if (existsSync(staged)) cleanupStagedOutput(staged);
    }
    if (statSync(input).size !== beforeBytes || !existsSync(target)) {
      throw new Error(`Input changed or output missing for ${item.name}`);
    }
    process.stdout.write(`Verified stream-copy .${container.extension}: ${meta.codec}, ${statSync(target).size} bytes\n`);
  }

  // FLAC's original total-samples STREAMINFO metadata can survive a
  // packet-copy trim, reporting the full source duration. The Cutter must
  // explicitly reject it rather than returning a misleading "lossless" cut.
  const flacSource = join(folder, "original.flac");
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-i", original, "-vn", "-c:a", "flac", flacSource,
  ]);
  const flacMeta = probe(ffprobe, flacSource);
  if (resolveStreamCopyContainer(flacMeta) !== null) {
    throw new Error("FLAC stream-copy falsely advertised as a reliable time-range cut.");
  }
  const flacAsWav = join(folder, "flac-transcoded-lossless.wav");
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-ss", "0.5", "-i", flacSource, "-t", "1.25",
    "-map", "0:a:0", "-vn", "-c:a", "pcm_s24le", flacAsWav,
  ]);
  const wavMeta = probe(ffprobe, flacAsWav);
  if (wavMeta.codec !== "pcm_s24le" || Math.abs(wavMeta.duration - 1.25) > 0.06) {
    throw new Error("FLAC → lossless WAV fallback did not preserve time range.");
  }
  process.stdout.write("Verified FLAC stream-copy rejection and lossless WAV alternative\\n");

  // A misleading extension must not be selected from the file's name.
  const spoofed = join(folder, "renamed-wav.mp3");
  copyFileSync(original, spoofed);
  const actual = probe(ffprobe, spoofed);
  const derived = resolveStreamCopyContainer(actual);
  if (derived?.extension !== "wav") throw new Error("Filename spoof overrode actual WAV metadata.");
  const invalidPath = join(folder, "not-a-wav.mp3");
  const invalidOp: FfmpegOp = {
    kind: "trim", jobId: "invalid-copy", inputPath: spoofed,
    outputPath: invalidPath, startSec: 0.3, endSec: 1.5,
    outputFormat: "mp3", lossless: true,
  };
  let rejected = false;
  try { assertOutputExtension(invalidOp, actual); }
  catch { rejected = true; }
  if (!rejected || existsSync(invalidPath)) throw new Error("Spoofed stream-copy output was not rejected.");
  process.stdout.write("Verified mismatched filename cannot override probed container\n");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
