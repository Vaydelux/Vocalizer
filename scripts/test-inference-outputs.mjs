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

  // Four-stem output must be complete, distinct, isolated, and atomic.
  const four = [
    { stem: "Vocals", path: path.join(scratch, "four_(Vocals).wav") },
    { stem: "Drums", path: path.join(scratch, "four_(Drums).wav") },
    { stem: "Bass", path: path.join(scratch, "four_(Bass).wav") },
    { stem: "Other", path: path.join(scratch, "four_(Other).wav") },
  ];
  for (const item of four) fs.writeFileSync(item.path, "test-" + item.stem);
  const publishedFour = publishInferenceStems(four, scratch, dest, "fourstem");
  assert.deepEqual(publishedFour.map(x => x.stem), ["Vocals", "Drums", "Bass", "Other"]);
  for (const item of publishedFour) {
    assert.equal(fs.readFileSync(item.path,"utf8"), "test-" + item.stem);
  }
  assert.throws(()=>publishInferenceStems(four.slice(0,3),scratch,dest,"partialfour"), /complete/);
  assert.throws(()=>publishInferenceStems([...four.slice(0,3),four[0]],scratch,dest,"duplicatefour"), /complete/);
  assert.throws(()=>publishInferenceStems([
    {stem:"Vocals",path:four[0].path},
    {stem:"Instrumental",path:four[1].path},
    {stem:"Bass",path:four[2].path},
    {stem:"Other",path:four[3].path}
  ],scratch,dest,"mixedfour"), /complete/);
  const oldDrums = path.join(dest,"Vocalizer-collision4-drums.wav");
  fs.writeFileSync(oldDrums,"user-original");
  assert.throws(()=>publishInferenceStems(four,scratch,dest,"collision4"), /already exists|EEXIST/);
  assert.equal(fs.readFileSync(oldDrums,"utf8"), "user-original");
  assert.equal(fs.existsSync(path.join(dest,"Vocalizer-collision4-vocals.wav")),false);

  const leaked=fs.mkdtempSync(path.join(scratchRoot,"job-"));
  fs.writeFileSync(path.join(leaked,"partial.wav"),"data");
  assert.equal(cleanupInferenceScratch(root),2);
  assert.equal(fs.existsSync(leaked),false);
  assert.equal(fs.existsSync(old),true);
  console.log("PASS: AI output isolation, no-overwrite, rollback, and crash cleanup");
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
