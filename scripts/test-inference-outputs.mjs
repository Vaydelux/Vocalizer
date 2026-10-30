import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { publishInferenceStems, inferenceScratchBase, cleanupInferenceScratch } =
  require("../electron/dist/main/services/inference-outputs.js");

const root=fs.mkdtempSync(path.join(os.tmpdir(),"vocalizer-inference-"));
try {
  const scratchRoot=inferenceScratchBase(root);
  const scratch=fs.mkdtempSync((fs.mkdirSync(scratchRoot,{recursive:true}),path.join(scratchRoot,"job-")));
  const dest=path.join(root,"outputs");
  fs.mkdirSync(dest);
  const vocal=path.join(scratch,"x_(Vocals).wav");
  const inst=path.join(scratch,"x_(Instrumental).wav");
  fs.writeFileSync(vocal,"vox-test-content");
  fs.writeFileSync(inst,"inst-test-content");
  const stems=[{stem:"Vocals",path:vocal},{stem:"Instrumental",path:inst}];
  const done=publishInferenceStems(stems,scratch,dest,"abc123");
  assert.equal(done.length,2);
  assert.equal(fs.readFileSync(done[0].path,"utf8"),"vox-test-content");
  assert.equal(fs.readFileSync(done[1].path,"utf8"),"inst-test-content");
  assert.throws(()=>publishInferenceStems(stems,scratch,dest,"abc123"),/already exists|EEXIST/);
  assert.equal(fs.readFileSync(done[0].path,"utf8"),"vox-test-content");
  const old=path.join(dest,"Vocalizer-collision-instrumental.wav");
  fs.writeFileSync(old,"old-user-file");
  assert.throws(()=>publishInferenceStems(stems,scratch,dest,"collision"),/already exists|EEXIST/);
  assert.equal(fs.readFileSync(old,"utf8"),"old-user-file");
  assert.equal(fs.existsSync(path.join(dest,"Vocalizer-collision-vocals.wav")),false);
  assert.throws(()=>publishInferenceStems([{stem:"Vocals",path:vocal},{stem:"Vocals",path:inst}],scratch,dest,"abc234"),/Expected/);
  assert.throws(()=>publishInferenceStems([{stem:"Vocals",path:vocal},{stem:"Instrumental",path:old}],scratch,dest,"abc234"),/outside/);
  const leaked=fs.mkdtempSync(path.join(scratchRoot,"job-"));
  fs.writeFileSync(path.join(leaked,"partial.wav"),"data");
  assert.equal(cleanupInferenceScratch(root),2);
  assert.equal(fs.existsSync(leaked),false);
  assert.equal(fs.existsSync(old),true);
  console.log("PASS: AI output isolation, no-overwrite, rollback, and crash cleanup");
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
