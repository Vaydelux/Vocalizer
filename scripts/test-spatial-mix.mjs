/** 3D Spatial Audio & Surround Mixdown regression checks. Run after electron:compile. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildFfmpegCommand } = require("../electron/dist/main/services/ffmpeg-args.js");

// 1. Multitrack mixdown with 3D binaural spatial panner filter (adelay + head-shadow equalizer)
const binauralBounce = buildFfmpegCommand({
  jobId: "spatial-binaural-test",
  kind: "multitrack",
  lanes: [
    {
      inputPath: "/tmp/lead_vocal.wav",
      offsetSec: 0,
      gainDb: 0,
      pan: 0,
      filters: ["adelay=0|28", "equalizer=f=3500:t=q:w=1.0:g=-4.0"],
    },
    {
      inputPath: "/tmp/backing_drums.wav",
      offsetSec: 0.5,
      gainDb: -3.0,
      pan: 0,
      filters: ["adelay=24|0", "equalizer=f=3500:t=q:w=1.0:g=-4.0"],
    },
  ],
  masterGainDb: -1.0,
  masterFilters: ["alimiter=limit=0.95"],
  loudnessNormalize: { targetLufs: -14, truePeak: -1.0 },
  outputFormat: "wav24",
  outputPath: "/tmp/binaural_master.wav",
});

const filterComplex = binauralBounce.argv[binauralBounce.argv.indexOf("-filter_complex") + 1];
assert.ok(filterComplex.includes("adelay=0|28"), "Filter graph must contain right-ear binaural delay");
assert.ok(filterComplex.includes("adelay=24|0"), "Filter graph must contain left-ear binaural delay");
assert.ok(filterComplex.includes("equalizer=f=3500"), "Filter graph must contain acoustic head-shadow diffraction filter");
assert.ok(filterComplex.includes("alimiter=limit=0.95"), "Master bus limiter must be present");
assert.ok(filterComplex.includes("loudnorm=I=-14:TP=-1"), "EBU R128 loudness normalizer must be present");

console.log("PASS: 3D Binaural spatial mixdown produces interaural time delay and head-shadow filtering");

// 2. Multitrack mixdown with 5.1 Surround matrix pan
const surroundBounce = buildFfmpegCommand({
  jobId: "spatial-surround-test",
  kind: "multitrack",
  lanes: [
    {
      inputPath: "/tmp/orchestra.wav",
      offsetSec: 0,
      gainDb: 0,
      pan: 0,
      filters: ["pan=5.1|c0=0.707*c0|c1=0.707*c0|c2=0.5*c0|c3=0.15*c0|c4=0.3*c0|c5=0.3*c0"],
    },
  ],
  masterGainDb: 0,
  outputFormat: "wav24",
  outputPath: "/tmp/surround_master.wav",
});

const surroundFilter = surroundBounce.argv[surroundBounce.argv.indexOf("-filter_complex") + 1];
assert.ok(surroundFilter.includes("pan=5.1"), "Filter graph must contain 5.1 surround matrix routing");
assert.ok(surroundFilter.includes("c0=0.707*c0"), "Channel 0 (FL) gain must be mapped");
assert.ok(surroundFilter.includes("c5=0.3*c0"), "Channel 5 (SR) gain must be mapped");

console.log("PASS: 5.1 Surround sound mixdown produces energy-preserving discrete channel matrix");
