import { describe, it, expect } from "bun:test";
import {
  computeSha256,
  evaluateEbuR128Compliance,
  complianceEntrySchema,
  type ComplianceEntry,
} from "../../src/lib/studio/compliance";

describe("enterprise compliance & audit reporting", () => {
  it("computes reproducible cryptographic SHA-256 hashes", async () => {
    const data = new TextEncoder().encode("vocalizer-audio-master-stream");
    const hash1 = await computeSha256(data);
    const hash2 = await computeSha256(data);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // 256 bits = 64 hex characters
  });

  it("evaluates EBU R128 broadcast compliance properly", () => {
    // Exact streaming standard: -14.0 LUFS, -1.0 dBFS True Peak
    expect(evaluateEbuR128Compliance(-14.0, -1.0)).toBe(true);
    expect(evaluateEbuR128Compliance(-14.2, -1.2)).toBe(true);

    // Too loud (True peak clipping risk)
    expect(evaluateEbuR128Compliance(-14.0, -0.2)).toBe(false);

    // Too quiet (outside -15.5 LUFS)
    expect(evaluateEbuR128Compliance(-19.0, -1.5)).toBe(false);
  });

  it("validates compliance audit entry schema against zod", () => {
    const validEntry: ComplianceEntry = {
      id: "audit-123456",
      timestamp: new Date().toISOString(),
      jobId: "job-bounce-99",
      operation: "mixdown",
      input: {
        name: "multitrack_session.vocalizer",
        sizeBytes: 15420000,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        channels: 2,
        sampleRate: 48000,
      },
      output: {
        name: "master_mixdown_mastered.wav",
        sizeBytes: 10584000,
        sha256: "ca978112ca1bbdcafac231b39a23dc4da7860814416090e294711ff729d3b8e4",
        format: "wav24",
        sampleRate: 48000,
        channels: 2,
        durationSec: 184.2,
      },
      loudnessMetrics: {
        integratedLufs: -14.0,
        truePeakDb: -1.0,
        loudnessRangeLra: 8.5,
        ebuR128Compliant: true,
      },
      dspApplied: ["3-Band EQ", "Dynamic Compressor", "Peak Limiter"],
      operator: "Lead Mastering Engineer",
    };

    const result = complianceEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
  });
});
