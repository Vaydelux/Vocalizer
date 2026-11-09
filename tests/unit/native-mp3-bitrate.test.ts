import { describe, expect, it } from "bun:test";
import { buildFfmpegCommand } from "../../electron/main/services/ffmpeg-args";
import { ffmpegOpSchema } from "../../electron/shared/ipc";
import { resolveNativeExportSettings } from "../../src/lib/studio/native-export-settings";

// Exercise every FFmpeg native export kind through its actual validated IPC
// contract, not just the stand-alone encoder helper.
const nativeOperations: Array<{ label: string; fields: Record<string, unknown> }> = [
  { label: "trim", fields: { kind: "trim", inputPath: "song.wav", startSec: 0, endSec: 2 } },
  { label: "join", fields: { kind: "join", inputPaths: ["a.wav", "b.wav"], crossfadeSec: 0 } },
  { label: "pitch", fields: {
    kind: "pitch", inputPath: "song.wav", semitones: 0, cents: 0,
    tempo: 1, preserveDuration: false,
  } },
  { label: "convert", fields: { kind: "convert", inputPath: "song.wav", sampleRate: null } },
  { label: "karaoke mix", fields: {
    kind: "mix", instrumentalPath: "instrumental.wav",
    vocalPath: "microphone.wav", vocalStartSec: 0,
  } },
  { label: "multitrack mixdown", fields: {
    kind: "multitrack", lanes: [{
      inputPath: "song.wav", offsetSec: 0, gainDb: 0, pan: 0,
    }], masterGainDb: 0,
  } },
];

function ffmpegArgs(fields: Record<string, unknown>, bitrate?: number, format = "mp3") {
  const parsed = ffmpegOpSchema.parse({
    ...fields,
    jobId: "bitrate-regression",
    outputFormat: format,
    outputPath: format === "mp3" ? "out.mp3" : "out.wav",
    ...(bitrate !== undefined ? { mp3Bitrate: bitrate } : {}),
  });
  return buildFfmpegCommand(parsed).argv;
}

describe("MP3 bitrate across native Electron FFmpeg", () => {
  for (const { label, fields } of nativeOperations) {
    for (const bitrate of [128, 192, 256, 320]) {
      it(`${label}: emits exact ${bitrate} kbps encoder arguments`, () => {
        const argv = ffmpegArgs(fields, bitrate);
        expect(argv.filter((arg) => arg === "-b:a")).toHaveLength(1);
        expect(argv[argv.indexOf("-b:a") + 1]).toBe(`${bitrate}k`);
        expect(argv[argv.indexOf("-acodec") + 1]).toBe("libmp3lame");
      });
    }

    it(`${label}: supports legacy requests without a bitrate`, () => {
      const argv = ffmpegArgs(fields);
      expect(argv[argv.indexOf("-b:a") + 1]).toBe("192k");
    });

    it(`${label}: never adds an MP3 rate to a WAV export`, () => {
      const argv = ffmpegArgs(fields, 320, "wav");
      expect(argv).not.toContain("-b:a");
      expect(argv[argv.indexOf("-acodec") + 1]).toBe("pcm_s16le");
    });
  }

  it("rejects unsupported or malformed bitrates at the IPC boundary", () => {
    for (const invalid of [0, 96, 160, 384, 999, -1, Number.NaN, Infinity, "320k"]) {
      const valid = ffmpegOpSchema.safeParse({
        ...nativeOperations[0].fields,
        jobId: "bad-bitrate",
        outputFormat: "mp3",
        outputPath: "out.mp3",
        mp3Bitrate: invalid,
      });
      expect(valid.success).toBe(false);
    }
  });

  it("treats lossless copy as a source-stream copy, not MP3 reencoding", () => {
    const argv = ffmpegArgs({
      kind: "trim", inputPath: "song.mp3", startSec: 0, endSec: 2,
      lossless: true,
    }, 320);
    expect(argv).toContain("copy");
    expect(argv).not.toContain("-b:a");
  });
});

describe("native export preferences", () => {
  const defaults = { exportFormat: "mp3" as const, mp3Bitrate: 256 as const };
  it("uses saved preferences if the task omits overrides", () => {
    expect(resolveNativeExportSettings(undefined, defaults))
      .toEqual({ format: "mp3", mp3Bitrate: 256 });
  });
  it("uses the selected job bitrate instead of the saved bitrate", () => {
    expect(resolveNativeExportSettings({ format: "mp3", mp3Bitrate: 320 }, defaults))
      .toEqual({ format: "mp3", mp3Bitrate: 320 });
  });
  it("permits a format-only override without resetting the saved bitrate", () => {
    expect(resolveNativeExportSettings({ format: "wav24" }, defaults))
      .toEqual({ format: "wav24", mp3Bitrate: 256 });
  });
});
