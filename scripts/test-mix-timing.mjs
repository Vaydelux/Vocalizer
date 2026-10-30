import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildFfmpegCommand } = require("../electron/dist/main/services/ffmpeg-args.js");

function makeMix(vocalStartSec) {
  return buildFfmpegCommand({
    kind:"mix", jobId:"timing-test", instrumentalPath:"C:/fixtures/instrumental.wav",
    vocalPath:"C:/fixtures/voice.webm", outputPath:"C:/fixtures/mix.wav",
    outputFormat:"wav", vocalStartSec, vocalGainDb:0, instrumentalGainDb:0
  }).argv;
}
for (const sec of [0, 0.4, 3]) {
  const args = makeMix(sec);
  assert.equal(args[0],"-nostdin");
  assert.equal(args[1],"-n");
  const filter=args[args.indexOf("-filter_complex")+1];
  assert.match(filter, /\[0\]volume=1\.000000\[i\]/);
  assert.match(filter, new RegExp("\\[1\\]volume=1\\.000000,adelay="+Math.round(sec*1000)+":all=1\\[v\\]"));
  assert.match(filter, /\[i\]\[v\]amix=inputs=2/);
  assert.ok(!filter.split(";")[0].includes("adelay"), "instrumental must not be delayed");
}
console.log("PASS: Karaoke mic alignment delays only the recorded vocal");
