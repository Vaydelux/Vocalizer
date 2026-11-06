/** Timeline Automation & Dynamic Envelope FFmpeg mixdown regression checks. Run after electron:compile. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildFfmpegCommand } = require("../electron/dist/main/services/ffmpeg-args.js");

// 1. Multitrack mixdown with volume automation (frame-eval piecewise linear ramp & hermite bezier curve)
const volumeAutoFilter = "volume=eval=frame:volume='if(between(t,0,2),0+((t-0)/2)*(1.5-0),if(between(t,2,5),1.5+((t-2)/3)*(0.5-1.5),0.5))'";
const panAutoFilter = "stereotools=mpan='if(between(t,1,4),-1+((t-1)/3)*(1--1),1)'";

const automatedBounce = buildFfmpegCommand({
  jobId: "automation-bounce-test",
  kind: "multitrack",
  lanes: [
    {
      inputPath: "/tmp/lead_synth.wav",
      offsetSec: 0,
      gainDb: 0,
      pan: 0,
      filters: [volumeAutoFilter, panAutoFilter],
    },
    {
      inputPath: "/tmp/bass_line.wav",
      offsetSec: 1.0,
      gainDb: -2.0,
      pan: 0,
      filters: ["equalizer=f=120:t=q:w=1.0:g=3.0"],
    },
  ],
  masterGainDb: -0.5,
  masterFilters: ["alimiter=limit=0.98"],
  loudnessNormalize: { targetLufs: -14, truePeak: -1.0 },
  outputFormat: "flac",
  outputPath: "/tmp/automation_master.flac",
});

const filterComplex = automatedBounce.argv[automatedBounce.argv.indexOf("-filter_complex") + 1];

assert.ok(
  filterComplex.includes("volume=eval=frame:volume="),
  "Filter graph must contain dynamic frame-eval volume envelope"
);
assert.ok(
  filterComplex.includes("stereotools=mpan="),
  "Filter graph must contain dynamic stereotools pan envelope"
);
assert.ok(
  filterComplex.includes("equalizer=f=120"),
  "Filter graph must contain static DSP parametric EQ filter"
);
assert.ok(
  filterComplex.includes("amix=inputs=2"),
  "Filter graph must sum automated lanes through amix"
);
assert.ok(
  filterComplex.includes("alimiter=limit=0.98"),
  "Master bus limiter must be present"
);
assert.ok(
  filterComplex.includes("loudnorm=I=-14:TP=-1"),
  "EBU R128 loudness normalization must be applied"
);

console.log("PASS: Multitrack mixdown compiles frame-evaluated volume and pan automation curves with DSP rack and limiter.");
