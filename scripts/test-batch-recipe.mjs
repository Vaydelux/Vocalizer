/** Batch recipe & conversion FFmpeg regression checks. Run after electron:compile. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildFfmpegCommand } = require("../electron/dist/main/services/ffmpeg-args.js");

// 1. Convert operation with 24-bit WAV, 48kHz sample rate, and EBU R128 loudness normalization
const batchConvertWav = buildFfmpegCommand({
  jobId: "batch-test-1",
  kind: "convert",
  inputPath: "/tmp/batch_input.wav",
  sampleRate: 48000,
  loudnessNormalize: { targetLufs: -14, truePeak: -1.0 },
  outputFormat: "wav24",
  outputPath: "/tmp/batch_output_mastered.wav",
});

assert.ok(batchConvertWav.argv.includes("pcm_s24le"));
assert.ok(batchConvertWav.argv.includes("-ar"));
const arIdx = batchConvertWav.argv.indexOf("-ar");
assert.equal(batchConvertWav.argv[arIdx + 1], "48000");

assert.ok(batchConvertWav.argv.includes("-af"));
const afIdx = batchConvertWav.argv.indexOf("-af");
assert.ok(batchConvertWav.argv[afIdx + 1].includes("loudnorm=I=-14:TP=-1:LRA=11"));

console.log("PASS: batch convert produces 24-bit PCM, 48kHz resampling, and EBU R128 loudnorm");

// 2. Convert operation with MP3 320kbps
const batchConvertMp3 = buildFfmpegCommand({
  jobId: "batch-test-2",
  kind: "convert",
  inputPath: "/tmp/batch_input.wav",
  sampleRate: null,
  outputFormat: "mp3",
  outputPath: "/tmp/batch_output.mp3",
});

assert.ok(batchConvertMp3.argv.includes("libmp3lame"));
console.log("PASS: batch convert produces libmp3lame encoder");
