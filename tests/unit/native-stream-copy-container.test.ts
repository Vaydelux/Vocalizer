import { describe, expect, it } from "bun:test";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStreamCopyContainer } from "../../electron/shared/stream-copy";
import { assertOutputExtension } from "../../electron/main/services/ffmpeg-output-preflight";
import { buildFfmpegCommand } from "../../electron/main/services/ffmpeg-args";
import { createStagedOutput, cleanupStagedOutput } from "../../electron/main/services/export-file";
import type { FfmpegOp } from "../../electron/shared/ipc";

const pairs = [
  ["mp3", "mp3", "mp3"],
  ["wav", "pcm_s16le", "wav"],
  ["wav", "pcm_f32le", "wav"],
  ["mov,mp4,m4a,3gp,3g2,mj2", "aac", "m4a"],
  ["mov,mp4,m4a,3gp,3g2,mj2", "alac", "m4a"],
  ["aac", "aac", "aac"],
  ["ogg", "vorbis", "ogg"],
  ["ogg", "opus", "opus"],
  ["matroska,webm", "opus", "webm"],
  ["aiff", "pcm_s16be", "aiff"],
  ["asf", "wmav2", "wma"],
] as const;

const sourceOp = (outputPath: string): FfmpegOp => ({
  kind: "trim",
  jobId: "cutter-copy",
  inputPath: "C:/audio/source.fake",
  outputPath,
  startSec: 0.25,
  endSec: 1.5,
  outputFormat: "wav",
  lossless: true,
});

describe("verified lossless Cutter output containers", () => {
  for (const [format, codec, expected] of pairs) {
    it(`${format} + ${codec} maps to .${expected} without filename guessing`, () => {
      const container = resolveStreamCopyContainer({ format, codec });
      expect(container?.extension).toBe(expected);
      expect(container?.mime.startsWith("audio/")).toBe(true);
      expect(() => assertOutputExtension(sourceOp(`C:/audio/cut.${expected}`), { format, codec }))
        .not.toThrow();
      expect(() => assertOutputExtension(sourceOp("C:/audio/cut.xyz"), { format, codec }))
        .toThrow(`.${expected}`);
    });
  }

  it("refuses a renamed file with an incompatible codec/container", () => {
    for (const meta of [
      { format: "flac", codec: "flac" },
      { format: "wav", codec: "mp3" },
      { format: "mp3", codec: "pcm_s16le" },
      { format: "mov,mp4,m4a,3gp,3g2,mj2", codec: "h264" },
      { format: "ogg", codec: "aac" },
      { format: "matroska,webm", codec: "flac" },
      { format: null, codec: "mp3" },
      { format: "wav", codec: null },
    ]) {
      expect(resolveStreamCopyContainer(meta)).toBeNull();
      expect(() => assertOutputExtension(sourceOp("C:/audio/cut.wav"), meta))
        .toThrow("unsupported");
    }
  });

  it("prevents loudness normalization during bitstream stream-copy", () => {
    const op: FfmpegOp = {
      ...sourceOp("C:/audio/cut.mp3"),
      loudnessNormalize: { targetLufs: -14, truePeak: -1 },
    };
    expect(() => assertOutputExtension(op, { format: "mp3", codec: "mp3" }))
      .toThrow("cannot apply loudness");
  });

  it("uses the first verified audio stream and copies packets without reencoding", () => {
    const command = buildFfmpegCommand(sourceOp("C:/audio/cut.mp3")).argv;
    expect(command.slice(command.indexOf("-map"), command.indexOf("-map") + 2))
      .toEqual(["-map", "0:a:0"]);
    expect(command[command.indexOf("-c:a") + 1]).toBe("copy");
    expect(command).not.toContain("libmp3lame");
    expect(command).not.toContain("-b:a");
  });

  it("rejects extension/codec mismatch before creating destination files", () => {
    const root = mkdtempSync(join(tmpdir(), "vocalizer-copy-test-"));
    try {
      const expected = join(root, "out.m4a");
      expect(() => assertOutputExtension(
        sourceOp(join(root, "out.wav")),
        { format: "mov,mp4,m4a,3gp,3g2,mj2", codec: "aac" },
      )).toThrow(".m4a");
      expect(existsSync(expected)).toBe(false);

      const partial = createStagedOutput(expected);
      expect(partial.endsWith(".m4a")).toBe(true);
      writeFileSync(partial, "test");
      cleanupStagedOutput(partial);
      expect(existsSync(partial)).toBe(false);
      expect(existsSync(expected)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still requires re-encoded outputs to match selected format", () => {
    const encoded: FfmpegOp = {
      ...sourceOp("C:/audio/output.mp3"),
      lossless: false,
      outputFormat: "mp3",
    };
    expect(() => assertOutputExtension(encoded)).not.toThrow();
    expect(() => assertOutputExtension({ ...encoded, outputPath: "C:/audio/output.wav" }))
      .toThrow(".mp3");
  });
});
