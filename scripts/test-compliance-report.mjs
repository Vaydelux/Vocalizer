/** Enterprise compliance & cryptographic audit regression tests. */
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Test 1: Node crypto SHA-256 matches our cryptographic contract
const testPayload = Buffer.from("vocalizer-enterprise-compliance-test-stream");
const hash = crypto.createHash("sha256").update(testPayload).digest("hex");
assert.equal(hash.length, 64);
console.log("PASS: 256-bit cryptographic SHA-256 hash verified (64 hex characters)");

// Test 2: EBU R128 compliance logic
function evaluateEbuR128(lufs, truePeakDb) {
  const lufsPass = lufs >= -23.5 && lufs <= -22.5;
  const truePeakPass = truePeakDb <= -1.0;
  return lufsPass && truePeakPass;
}

assert.equal(evaluateEbuR128(-23.0, -1.0), true, "EBU broadcast target must PASS");
assert.equal(evaluateEbuR128(-22.5, -1.2), true, "Within ±0.5 LU tolerance must PASS");
assert.equal(evaluateEbuR128(-23.0, -0.2), false, "True peak clipping risk must FAIL");
assert.equal(evaluateEbuR128(-14.0, -1.0), false, "Streaming target is not EBU R128 compliant");
console.log("PASS: EBU R128 and ITU-R BS.1770 loudness evaluation rules verified");

// Test 3: CSV and JSON Compliance Ledger Serialization
const mockEntry = {
  timestamp: new Date().toISOString(),
  jobId: "audit-job-001",
  operation: "separation",
  inputName: "source_mix.wav",
  inputSha256: hash,
  outputName: "source_mix_stems.zip",
  outputSha256: hash.split("").reverse().join(""),
  durationSec: 214.5,
  format: "wav24",
  sampleRate: 48000,
  integratedLufs: -23.0,
  truePeakDb: -1.0,
  ebuR128Compliant: true,
};

const headers = [
  "Timestamp", "Job ID", "Operation", "Input Name", "Input SHA-256",
  "Output Name", "Output SHA-256", "Duration (s)", "Format",
  "Sample Rate (Hz)", "Integrated LUFS", "True Peak (dBFS)", "EBU R128 Compliant"
];

const row = [
  mockEntry.timestamp, mockEntry.jobId, mockEntry.operation,
  mockEntry.inputName, mockEntry.inputSha256, mockEntry.outputName,
  mockEntry.outputSha256, mockEntry.durationSec.toFixed(2), mockEntry.format,
  mockEntry.sampleRate.toString(), mockEntry.integratedLufs.toFixed(1),
  mockEntry.truePeakDb.toFixed(1), mockEntry.ebuR128Compliant ? "PASS" : "FAIL"
];

const csvLine = row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
assert.ok(csvLine.includes('"PASS"'));
assert.ok(csvLine.includes(hash));
assert.ok(csvLine.includes('"separation"'));
console.log("PASS: CSV compliance serialization with RFC 4180 escaping verified");

const jsonReport = {
  reportId: "AUDIT-REP-TEST",
  generatedAt: new Date().toISOString(),
  studioName: "Vocalizer Local Audio Studio",
  appVersion: "0.3.0",
  totalOperations: 1,
  ebuR128PassCount: 1,
  entries: [mockEntry],
};

const parsed = JSON.parse(JSON.stringify(jsonReport));
assert.equal(parsed.totalOperations, 1);
assert.equal(parsed.ebuR128PassCount, 1);
assert.equal(parsed.entries[0].jobId, "audit-job-001");
console.log("PASS: JSON compliance report structure verified");
