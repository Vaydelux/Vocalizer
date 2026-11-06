/**
 * Regression check: executing the packaged preload registers the typed bridge.
 * This catches malformed bundles even when renderer/main TypeScript compiles.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const bundle = path.resolve("electron/dist/preload/index.js");
assert.ok(fs.existsSync(bundle), "Preload bundle must be built before this test");
let exposedName = null;
let exposedApi = null;
const electron = {
  contextBridge: {
    exposeInMainWorld(name, api) {
      exposedName = name;
      exposedApi = api;
    },
  },
  ipcRenderer: {
    invoke() { return Promise.resolve({}); },
    on() {},
    removeListener() {},
  },
  webUtils: { getPathForFile() { return "fixture.wav"; } },
};

const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(bundle, "utf8"), {
  require(name) {
    assert.equal(name, "electron", "Bundled preload must have no local runtime imports");
    return electron;
  },
  module: mod,
  exports: mod.exports,
  console,
  Buffer,
  process,
}, { filename: bundle, timeout: 3000 });

assert.equal(exposedName, "studio", "Preload must expose window.studio");
assert.equal(exposedApi?.isNative, true);
for (const key of ["systemInfo", "runInference", "inferenceStatus", "probeMetadata", "runFfmpeg", "stageRecording", "onInferenceProgress"]) {
  assert.equal(typeof exposedApi[key], "function", "Missing native bridge method: " + key);
}
console.log("PASS: sandbox preload exposes complete native studio bridge");
