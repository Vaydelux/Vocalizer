/** Lossless trim and loudness normalization regression checks. Run after electron:compile. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildFfmpegCommand } = require("../electron/dist/main/services/ffmpeg-args.js");

// 1. Lossless trim produces stream copy
const losslessTrim = buildFfmpegCommand({
  jobId: "test-lossless-1",
  kind: "trim",
  inputPath: "/tmp/source.wav",
  startSec: 5.5,
  endSec: 15.5,
  lossless: true,
  outputFormat: "wav",
  outputPath: "/tmp/output_lossless.wav",
});

assert.ok(losslessTrim.argv.includes("-c:a"));
const copyIdx = losslessTrim.argv.indexOf("-c:a");
assert.equal(losslessTrim.argv[copyIdx + 1], "copy");
assert.equal(losslessTrim.requiresRubberBand, false);
console.log("PASS: Lossless trim produces stream copy (-c:a copy)");

// 2. Loudness normalization trim produces loudnorm filter
const loudnormTrim = buildFfmpegCommand({
  jobId: "test-loudnorm-1",
  kind: "trim",
  inputPath: "/tmp/source.wav",
  startSec: 0,
  endSec: 30,
  loudnessNormalize: { targetLufs: -14, truePeak: -1.0 },
  outputFormat: "wav",
  outputPath: "/tmp/output_loudnorm.wav",
});

assert.ok(loudnormTrim.argv.includes("-af"));
const afIdx = loudnormTrim.argv.indexOf("-af");
assert.equal(loudnormTrim.argv[afIdx + 1], "loudnorm=I=-14:TP=-1:LRA=11");
assert.ok(loudnormTrim.argv.includes("pcm_s16le"));
console.log("PASS: Loudness normalization produces loudnorm filter");

// 3. Regular trim encodes to specified format
const regularTrim = buildFfmpegCommand({
  jobId: "test-reg-1",
  kind: "trim",
  inputPath: "/tmp/source.mp3",
  startSec: 10,
  endSec: 20,
  outputFormat: "mp3",
  outputPath: "/tmp/output.mp3",
});
assert.ok(regularTrim.argv.includes("libmp3lame"));
console.log("PASS: Standard trim produces libmp3lame encoder");
