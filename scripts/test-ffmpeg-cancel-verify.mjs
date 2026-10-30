/**
 * Regression: cancellation remains effective between FFmpeg process exit and
 * the asynchronous FFprobe/publish stage. Uses a fake process + probe, not a
 * GPU, operating system media codec, or private recording.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
// The genuine path resolver imports Electron's main process at module load.
// Mock these two dependencies in Node's module cache BEFORE requiring FFmpeg.
const pathsPath = require.resolve("../electron/dist/main/services/paths.js");
const probePath = require.resolve("../electron/dist/main/services/ffprobe.js");
const previousPaths = require.cache[pathsPath];
const previousProbe = require.cache[probePath];
const pathsStub = { getFfmpegPath: () => "test-ffmpeg" };
const probeStub = { probeFile: async () => ({ duration:2 }) };
require.cache[pathsPath] = { id:pathsPath, filename:pathsPath, loaded:true, exports:pathsStub };
require.cache[probePath] = { id:probePath, filename:probePath, loaded:true, exports:probeStub };
const originalSpawn = childProcess.spawn;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vocalizer-cancel-race-"));
let releaseProbe;
let enteredProbe;
const probeStarted = new Promise((resolve) => { enteredProbe = resolve; });
const metadata = {duration:2, sampleRate:44100, channels:1, codec:"pcm_s16le", format:"wav", bitrateKbps:700, sizeBytes:12};

try {
  probeStub.probeFile = (filePath) => {
    if (path.basename(filePath).startsWith(".vocalizer-partial-")) {
      enteredProbe();
      return new Promise((resolve) => { releaseProbe = () => resolve(metadata); });
    }
    return Promise.resolve(metadata);
  };
  childProcess.spawn = (_bin, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => true;
    setImmediate(() => {
      fs.writeFileSync(args[args.length - 1], "synthetic-audio");
      child.exitCode = 0;
      child.emit("close", 0);
    });
    return child;
  };
  const { runFfmpeg, cancelJob } = require("../electron/dist/main/services/ffmpeg.js");
  const target = path.join(folder, "cancelled.wav");
  const operation = {
    kind:"trim", jobId:"cancel-race-1", inputPath:path.join(folder,"input.wav"),
    outputPath:target, outputFormat:"wav", startSec:0, endSec:1,
  };
  const pending = runFfmpeg(operation, () => {});
  await probeStarted;
  assert.equal(cancelJob("cancel-race-1"), true,
    "Cancellation must remain available while the output is being verified");
  releaseProbe();
  await assert.rejects(pending, (err) => err && err.code === "CANCELLED");
  assert.equal(fs.existsSync(target), false,
    "Cancelled output must not be published to the user's destination");
  assert.equal(cancelJob("cancel-race-1"), false,
    "Completed cancellation must remove the native registry entry");

  // A non-cancelled operation still verifies and publishes normally.
  probeStub.probeFile = async () => metadata;
  const successTarget = path.join(folder, "completed.wav");
  const completed = await runFfmpeg({...operation,jobId:"complete-1",outputPath:successTarget}, () => {});
  assert.equal(completed.verified, true);
  assert.equal(fs.readFileSync(successTarget,"utf8"), "synthetic-audio");
  assert.equal(cancelJob("complete-1"), false);
  console.log("PASS: native cancellation remains effective through verification, then cleans up");
} finally {
  childProcess.spawn = originalSpawn;
  if (previousPaths) require.cache[pathsPath] = previousPaths;
  else delete require.cache[pathsPath];
  if (previousProbe) require.cache[probePath] = previousProbe;
  else delete require.cache[probePath];
  fs.rmSync(folder,{recursive:true,force:true});
}
