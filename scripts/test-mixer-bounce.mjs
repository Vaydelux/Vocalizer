/** Multi-track mixer bounce FFmpeg regression checks. Run after electron:compile. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildFfmpegCommand } = require("../electron/dist/main/services/ffmpeg-args.js");

// 1. Multi-track mixdown with 3 lanes, individual gain, pan, delay, and EQ
const multitrackBounce = buildFfmpegCommand({
  jobId: "test-multitrack-1",
  kind: "multitrack",
  outputFormat: "wav",
  outputPath: "/tmp/master_bounce.wav",
  masterGainDb: -1.0,
  masterFilters: ["alimiter=limit=0.9500:release=50"],
  loudnessNormalize: { targetLufs: -14, truePeak: -1.0 },
  lanes: [
    {
      inputPath: "/tmp/drums.wav",
      offsetSec: 0,
      gainDb: 1.5,
      pan: 0,
    },
    {
      inputPath: "/tmp/vocal.wav",
      offsetSec: 2.5,
      gainDb: 0,
      pan: -0.25, // panned slightly left
      filters: ["equalizer=f=1200:width_type=q:w=1.0:g=2.0"],
    },
    {
      inputPath: "/tmp/synth.wav",
      offsetSec: 0,
      gainDb: -3.0,
      pan: 0.5, // panned right
    },
  ],
});

// Check that 3 inputs are mapped
const inputIndices = multitrackBounce.argv.flatMap((arg, i) => (arg === "-i" ? [i + 1] : []));
assert.equal(inputIndices.length, 3);
assert.equal(multitrackBounce.argv[inputIndices[0]], "/tmp/drums.wav");
assert.equal(multitrackBounce.argv[inputIndices[1]], "/tmp/vocal.wav");
assert.equal(multitrackBounce.argv[inputIndices[2]], "/tmp/synth.wav");

// Check filter complex
const fcIdx = multitrackBounce.argv.indexOf("-filter_complex");
assert.ok(fcIdx !== -1);
const filterComplex = multitrackBounce.argv[fcIdx + 1];

// Assert delay on vocal track (2500ms)
assert.ok(filterComplex.includes("adelay=2500:all=1"));

// Assert pan filter on panned tracks
assert.ok(filterComplex.includes("pan=stereo"));

// Assert EQ filter on vocal track
assert.ok(filterComplex.includes("equalizer=f=1200:width_type=q:w=1.0:g=2.0"));

// Assert amix combining all 3 lanes
assert.ok(filterComplex.includes("amix=inputs=3:duration=longest:normalize=0"));

// Assert master loudness normalization
assert.ok(filterComplex.includes("loudnorm=I=-14:TP=-1:LRA=11"));

// Assert master limiter
assert.ok(filterComplex.includes("alimiter=limit=0.9500:release=50"));

console.log("PASS: multi-track mixer bounce generates verified multi-input filter graph");
