/**
 * Actual FFmpeg Joiner acceptance: synthesize unlicensed test tones, join
 * mixed-rate and mixed-channel inputs, then probe the resulting WAV.
 *
 * Usage: bun scripts/smoke-join-ffmpeg.ts <ffmpeg> <ffprobe>
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFfmpegCommand } from "../electron/main/services/ffmpeg-args";
import type { FfmpegOp } from "../electron/shared/ipc";

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

const ffmpeg = process.argv[2];
const ffprobe = process.argv[3];
if (!ffmpeg || !ffprobe) {
  throw new Error("Usage: bun scripts/smoke-join-ffmpeg.ts <ffmpeg> <ffprobe>");
}

const root = mkdtempSync(join(tmpdir(), "vocalizer-join-"));
try {
  const inputs = [
    { file: join(root, "a.wav"), rate: 44100, channels: 1, hz: 400 },
    { file: join(root, "b.wav"), rate: 48000, channels: 2, hz: 550 },
    { file: join(root, "c.flac"), rate: 44100, channels: 2, hz: 700 },
  ];
  for (const item of inputs) {
    run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
      "-f", "lavfi",
      "-i", `sine=frequency=${item.hz}:sample_rate=${item.rate}:duration=1`,
      "-ac", String(item.channels), item.file,
    ]);
  }

  for (const crossfadeSec of [0, 0.5]) {
    const outputPath = join(root, crossfadeSec ? "crossfade.wav" : "concat.wav");
    const op: FfmpegOp = {
      jobId: "synthetic-join-smoke",
      kind: "join",
      inputPaths: inputs.map((item) => item.file),
      crossfadeSec,
      overlapSeconds: crossfadeSec ? [0.5, 0.25] : [0, 0],
      sampleRate: 48000,
      channels: 2,
      outputFormat: "wav",
      outputPath,
    };
    const built = buildFfmpegCommand(op);
    run(ffmpeg, ["-hide_banner", "-loglevel", "error", ...built.argv]);
    const probe = JSON.parse(run(ffprobe, [
      "-v", "error", "-show_entries", "stream=codec_type,channels,sample_rate:format=duration",
      "-of", "json", outputPath,
    ])) as {
      streams?: Array<{ codec_type: string; channels: number; sample_rate: string }>;
      format?: { duration: string };
    };
    const stream = probe.streams?.find((entry) => entry.codec_type === "audio");
    const actual = Number(probe.format?.duration);
    const expected = crossfadeSec ? 2.25 : 3.0;
    if (!stream || stream.channels !== 2 || Number(stream.sample_rate) !== 48000 ||
        !Number.isFinite(actual) || Math.abs(actual - expected) > 0.035) {
      throw new Error(`Unexpected join output: ${JSON.stringify({ expected, actual, stream })}`);
    }
    process.stdout.write(`Joiner ${crossfadeSec ? "crossfade" : "concat"} verified: ${actual.toFixed(3)}s, 48kHz stereo\\n`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
