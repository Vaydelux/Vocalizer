import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { stageRecordingBytes, cleanupOrphanedRecordings, discardRecordingFile } =
  require("../electron/dist/main/services/recording-staging.js");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "vocalizer-recordings-"));
try {
  const ogg = Uint8Array.from([79,103,103,83,0,1,2,3,4,5,6,7]);
  const file = await stageRecordingBytes(root, "test01", "ogg", ogg);
  assert.equal(path.extname(file), ".ogg");
  assert.deepEqual(new Uint8Array(await fs.readFile(file)), ogg);
  await assert.rejects(stageRecordingBytes(root,"test01","ogg",ogg), /EEXIST/);
  await assert.rejects(stageRecordingBytes(root,"../other","ogg",ogg), /Invalid/);
  await assert.rejects(stageRecordingBytes(root,"test02","m4a",ogg), /container/);
  await assert.rejects(stageRecordingBytes(root,"test02","ogg",new Uint8Array()), /1 byte to 64 MiB/);
  const second = await stageRecordingBytes(root,"test03","ogg",ogg);
  await discardRecordingFile(second);
  await assert.rejects(fs.stat(second), /ENOENT/);
  assert.equal(await cleanupOrphanedRecordings(root), 1);
  await assert.rejects(fs.stat(file), /ENOENT/);
  console.log("PASS: recording staging validates containers, prevents overwrite and cleans orphans");
} finally {
  await fs.rm(root, {recursive:true,force:true});
}
