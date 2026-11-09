/**
 * Native MP3 bitrate smoke test. Creates original synthetic audio, encodes
 * via the actual IPC operation builder, and checks MP3 codec and stream rate.
 *
 * Usage: bun scripts/smoke-native-mp3-bitrate.ts <ffmpeg> <ffprobe>
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFfmpegCommand } from "../electron/main/services/ffmpeg-args";
import { ffmpegOpSchema } from "../electron/shared/ipc";

function run(program: string, args: string[]): string {
  const result = spawnSync(program, args, {
    windowsHide: true,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${program} exited ${result.status}: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

const ffmpeg = process.argv[2];
const ffprobe = process.argv[3];
if (!ffmpeg || !ffprobe) {
  throw new Error("Usage: bun scripts/smoke-native-mp3-bitrate.ts <ffmpeg> <ffprobe>");
}

const folder = mkdtempSync(join(tmpdir(), "vocalizer-mp3-rate-"));
try {
  const inputPath = join(folder, "synthetic.wav");
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2",
    "-ac", "2", "-c:a", "pcm_s16le", inputPath,
  ]);

  for (const mp3Bitrate of [128, 320] as const) {
    const outputPath = join(folder, `encoded-${mp3Bitrate}.mp3`);
    const parsed = ffmpegOpSchema.parse({
      jobId: `rate-${mp3Bitrate}`,
      kind: "convert",
      inputPath,
      outputFormat: "mp3",
      mp3Bitrate,
      sampleRate: null,
      outputPath,
    });
    const { argv } = buildFfmpegCommand(parsed);
    if (argv[argv.indexOf("-b:a") + 1] !== `${mp3Bitrate}k`) {
      throw new Error(`Encoder did not receive ${mp3Bitrate} kbps`);
    }
    run(ffmpeg, ["-hide_banner", "-loglevel", "error", ...argv]);

    const probe = JSON.parse(run(ffprobe, [
      "-v", "error",
      "-show_entries", "stream=codec_name,bit_rate:format=duration",
      "-of", "json", outputPath,
    ])) as {
      streams?: Array<{ codec_name?: string; bit_rate?: string }>;
      format?: { duration?: string };
    };
    const stream = probe.streams?.find((item) => item.codec_name === "mp3");
    const actual = Number(stream?.bit_rate);
    const duration = Number(probe.format?.duration);
    const expected = mp3Bitrate * 1000;
    if (!stream || !Number.isFinite(actual) ||
        Math.abs(actual - expected) > expected * 0.08 ||
        !Number.isFinite(duration) || duration < 1.95 || duration > 2.15) {
      throw new Error(`MP3 output validation failed: ${JSON.stringify({ expected, actual, duration })}`);
    }
    process.stdout.write(`MP3 ${mp3Bitrate} kbps verified by FFprobe: ${actual} bps, ${duration.toFixed(2)}s\n`);
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}
