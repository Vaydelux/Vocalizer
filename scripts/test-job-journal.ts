import { strict as assert } from "node:assert";
import { readJobReceipts, recordJobReceipt, previousJobReceipts, clearJobReceipts } from "../src/lib/studio/job-journal";
const map = new Map<string, string>();
const storage = {
  getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => { map.set(key, value); },
  removeItem: (key: string) => { map.delete(key); },
} as Storage;
const job = {
  id:"receipt01", label:"Test synthetic WAV", type:"export" as const, state:"running" as const,
  createdAt:Date.now(), startedAt:Date.now(), endedAt:null,
  progress:null,stage:null,logs:[],error:null,result:null,
};
recordJobReceipt(job,storage);
assert.equal(readJobReceipts(storage).length,1);
assert.equal(readJobReceipts(storage)[0].state,"running");
const raw=map.get("vocalizer.job-receipts.v1")!;
const list=JSON.parse(raw);
list[0].session="previous-session";
map.set("vocalizer.job-receipts.v1",JSON.stringify(list));
assert.equal(previousJobReceipts(storage)[0].state,"interrupted");
list[0].state="completed";
map.set("vocalizer.job-receipts.v1",JSON.stringify(list));
assert.equal(previousJobReceipts(storage)[0].state,"completed");
map.set("vocalizer.job-receipts.v1","not-json");
assert.deepEqual(readJobReceipts(storage),[]);
clearJobReceipts(storage);
assert.equal(map.size,0);
console.log("PASS: local job journal handles interruption, success and corrupt data");
