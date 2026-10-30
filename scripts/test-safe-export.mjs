/** Native staging regression checks. Run after electron:compile. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createStagedOutput, publishStagedOutput, cleanupStagedOutput } =
  require("../electron/dist/main/services/export-file.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vocalizer-safe-export-"));
try {
  const target = path.join(root, "song.wav");
  const staging = createStagedOutput(target);
  assert.equal(path.dirname(staging), root);
  assert.equal(path.extname(staging), ".wav");
  fs.writeFileSync(staging, "verified-test-bytes");
  publishStagedOutput(staging, target);
  assert.equal(fs.readFileSync(target, "utf8"), "verified-test-bytes");
  assert.equal(fs.existsSync(staging), false);

  assert.throws(() => createStagedOutput(target), /already exists/);
  const collision = path.join(root, "collision.wav");
  const tmp = createStagedOutput(collision);
  fs.writeFileSync(tmp, "new-output");
  fs.writeFileSync(collision, "keep-me");
  assert.throws(() => publishStagedOutput(tmp, collision));
  assert.equal(fs.readFileSync(collision, "utf8"), "keep-me");
  cleanupStagedOutput(tmp);
  assert.equal(fs.existsSync(tmp), false);

  assert.throws(() => createStagedOutput(path.join(root, "wrong.txt")), /extension/);
  assert.throws(() => createStagedOutput("relative.mp3"), /absolute/);
  console.log("PASS: safe native staging and exclusive publish");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
